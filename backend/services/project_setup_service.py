from enum import Enum
from typing import Optional, Dict, Any
from datetime import datetime
import json
import os
import requests
from github import Github
from modal import app

from backend.db import Database
from backend.services.git_service import GitService
from backend.services.vercel_service import VercelService
from backend.config.project_config import ProjectConfig
from backend.utils.helpers import generate_random_secret
from backend.notifications import send_notification

class SetupState(Enum):
    INIT = "init"
    VALIDATING = "validating"
    GITHUB_SETUP = "github_setup"
    VERCEL_SETUP = "vercel_setup"
    CODE_UPDATE = "code_update"
    METADATA_UPDATE = "metadata_update"
    DOMAIN_SETUP = "domain_setup"
    NOTIFICATION = "notification"
    COMPLETE = "complete"
    FAILED = "failed"

class SetupContext:
    """Holds all context data for the setup process"""
    def __init__(self, data: dict, project_id: str, job_id: str):
        self.data = data
        self.project_id = project_id
        self.job_id = job_id
        self.user_context = data.get("userContext", {})
        self.project_name: Optional[str] = None
        self.repo: Optional[object] = None
        self.vercel_info: Optional[dict] = None
        self.frontend_url: Optional[str] = None
        self.error: Optional[str] = None
        self.completed_steps: set = set()

    def to_dict(self) -> dict:
        """Convert context to serializable dict"""
        return {
            "data": self.data,
            "project_id": self.project_id,
            "job_id": self.job_id,
            "user_context": self.user_context,
            "project_name": self.project_name,
            "repo_full_name": self.repo.full_name if self.repo else None,
            "vercel_info": self.vercel_info,
            "frontend_url": self.frontend_url,
            "error": self.error,
            "completed_steps": list(self.completed_steps)
        }

    @classmethod
    def from_dict(cls, data: dict, project_id: str, job_id: str) -> 'SetupContext':
        """Create context from saved state"""
        context = cls(data.get("data", {}), project_id, job_id)
        context.user_context = data.get("user_context", {})
        context.project_name = data.get("project_name")
        context.vercel_info = data.get("vercel_info")
        context.frontend_url = data.get("frontend_url")
        context.error = data.get("error")
        context.completed_steps = set(data.get("completed_steps", []))
        
        # Reconnect to GitHub repo if it exists
        if data.get("repo_full_name"):
            gh = Github(os.environ["GITHUB_TOKEN"])
            try:
                org_name, repo_name = data["repo_full_name"].split("/")
                org = gh.get_organization(org_name)
                context.repo = org.get_repo(repo_name)
            except Exception as e:
                print(f"Warning: Could not reconnect to GitHub repo: {e}")
        
        return context

class ProjectSetupService:
    """Manages the frame project setup process with state transitions and recovery"""
    
    MAX_ATTEMPTS = 3  # Maximum number of setup attempts per state
    
    def __init__(self, data: dict, project_id: str, job_id: str):
        self.db = Database()
        self.context = self._load_or_create_context(data, project_id, job_id)
        self.state = self._load_saved_state() or SetupState.INIT
        self.transitions = {
            SetupState.INIT: [SetupState.VALIDATING, SetupState.FAILED],
            SetupState.VALIDATING: [SetupState.GITHUB_SETUP, SetupState.FAILED],
            SetupState.GITHUB_SETUP: [SetupState.VERCEL_SETUP, SetupState.FAILED],
            SetupState.VERCEL_SETUP: [SetupState.CODE_UPDATE, SetupState.FAILED],
            SetupState.CODE_UPDATE: [SetupState.METADATA_UPDATE, SetupState.FAILED],
            SetupState.METADATA_UPDATE: [SetupState.DOMAIN_SETUP, SetupState.FAILED],
            SetupState.DOMAIN_SETUP: [SetupState.NOTIFICATION, SetupState.FAILED],
            SetupState.NOTIFICATION: [SetupState.COMPLETE, SetupState.FAILED],
            SetupState.COMPLETE: [],
            SetupState.FAILED: []
        }

    def advance(self) -> SetupState:
        """Advance to the next state based on current state"""
        try:
            self._log_state_transition()
            
            if self.state == SetupState.INIT:
                self._transition_to(SetupState.VALIDATING)
                self._validate_input()
                
            elif self.state == SetupState.VALIDATING:
                self._transition_to(SetupState.GITHUB_SETUP)
                self._setup_github()
                
            elif self.state == SetupState.GITHUB_SETUP:
                self._transition_to(SetupState.VERCEL_SETUP)
                self._setup_vercel()
                
            elif self.state == SetupState.VERCEL_SETUP:
                self._transition_to(SetupState.CODE_UPDATE)
                self._update_code()
                
            elif self.state == SetupState.CODE_UPDATE:
                self._transition_to(SetupState.METADATA_UPDATE)
                self._update_metadata()
                
            elif self.state == SetupState.METADATA_UPDATE:
                self._transition_to(SetupState.DOMAIN_SETUP)
                self._setup_domain()
                
            elif self.state == SetupState.DOMAIN_SETUP:
                self._transition_to(SetupState.NOTIFICATION)
                self._send_notification()
                
            elif self.state == SetupState.NOTIFICATION:
                self._transition_to(SetupState.COMPLETE)
                self._finalize_setup()

        except Exception as e:
            self.context.error = str(e)
            self._transition_to(SetupState.FAILED)
            self._handle_error(e)
            
        return self.state

    def _transition_to(self, new_state: SetupState) -> None:
        """Validate and perform state transition"""
        if new_state not in self.transitions[self.state]:
            raise ValueError(f"Invalid state transition from {self.state} to {new_state}")
        
        self.state = new_state
        self._log_state_transition()
        self._update_job_status()

    def _validate_input(self) -> None:
        """Validate all required input data"""
        required_fields = ["prompt", "description", "userContext"]
        missing_fields = [f for f in required_fields if f not in self.context.data]
        if missing_fields:
            raise ValueError(f"Missing required fields: {', '.join(missing_fields)}")
            
        if not self.context.user_context.get("fid"):
            raise ValueError("Missing fid in userContext")

    def _setup_github(self) -> None:
        """Set up GitHub repository"""
        from github import Github
        gh = Github(os.environ["GITHUB_TOKEN"])
        
        # Generate project name
        self.context.project_name = self._generate_project_name()
        
        # Create repo
        org = gh.get_organization(ProjectConfig.GITHUB["ORG_NAME"])
        self.context.repo = org.create_repo(
            name=self.context.project_name,
            description=self.context.data["description"],
            private=False
        )
        
        # Clone template and set up repo
        git_service = GitService(self.context.repo.full_name, self.context.job_id, self.db)
        git_service.ensure_repo_ready()

    def _setup_vercel(self) -> None:
        """Set up Vercel project and deployment"""
        vercel_config = {
            "TEAM_ID": os.environ["VERCEL_TEAM_ID"],
            "TOKEN": os.environ["VERCEL_TOKEN"],
            **ProjectConfig.VERCEL
        }
        
        vercel_service = VercelService(vercel_config, self.db, self.context.job_id)
        self.context.vercel_info = vercel_service.create_project(
            self.context.project_name,
            self.context.repo
        )
        
        self.context.frontend_url = f"https://{self.context.project_name}.vercel.app"
        
        # Update project record
        self.db.client.table("projects").update({
            "name": self.context.project_name,
            "repo_url": self.context.repo.html_url,
            "frontend_url": self.context.frontend_url,
            "vercel_project_id": self.context.vercel_info.get("id")
        }).eq("id", self.context.project_id).execute()

    def _update_code(self) -> None:
        """Update code with initial implementation"""
        from modal import app
        setup_prompt = self._get_setup_prompt()
        
        app.functions.update_code.remote({
            "project_id": self.context.project_id,
            "repo_path": self.context.repo.full_name,
            "prompt": setup_prompt,
            "user_context": self.context.user_context
        })

    def _update_metadata(self) -> None:
        """Update project metadata"""
        from modal import app
        metadata_prompt = self._get_metadata_prompt()
        
        app.functions.update_code.remote({
            "project_id": self.context.project_id,
            "repo_path": self.context.repo.full_name,
            "prompt": metadata_prompt,
            "job_type": "update_code_for_metadata"
        })

    def _setup_domain(self) -> None:
        """Set up Farcaster domain association"""
        from modal import app
        domain = self.context.frontend_url.replace("https://", "")
        domain_assoc = self._generate_domain_association(domain)
        
        update_prompt = f"""
        Update src/app/.well-known/farcaster.json/route.ts with:
        {json.dumps(domain_assoc['json'], indent=2)}
        """
        
        app.functions.update_code.remote({
            "project_id": self.context.project_id,
            "repo_path": self.context.repo.full_name,
            "prompt": update_prompt,
            "job_type": "update_code_for_domain_association"
        })

    def _send_notification(self) -> None:
        """Send completion notification"""
        from backend.notifications import send_notification
        
        if "fid" in self.context.user_context:
            try:
                send_notification(
                    fid=self.context.user_context["fid"],
                    title=f"Your {self.context.project_name} frame is ready!",
                    body="Frameception has prepared your frame, it's live! 🚀"
                )
            except Exception as e:
                self.db.add_log(
                    self.context.job_id,
                    "notification",
                    f"Warning: Could not send notification: {str(e)}"
                )

    def _finalize_setup(self) -> None:
        """Perform final cleanup and status updates"""
        self.db.update_job_status(self.context.job_id, "completed")

    def _handle_error(self, error: Exception) -> None:
        """Handle errors and update status"""
        error_msg = f"Error in {self.state.value}: {str(error)}"
        self.db.add_log(self.context.job_id, "backend", error_msg)
        self.db.update_job_status(self.context.job_id, "failed", error_msg)

    def _log_state_transition(self) -> None:
        """Log state transition"""
        self.db.add_log(
            self.context.job_id,
            "state",
            f"Project setup state: {self.state.value}"
        )

    def _update_job_status(self) -> None:
        """Update job status based on current state"""
        status = "completed" if self.state == SetupState.COMPLETE else "pending"
        self.db.update_job_status(self.context.job_id, status)

    def _generate_project_name(self) -> str:
        # Implementation from existing generate_project_name()
        pass

    def _get_setup_prompt(self) -> str:
        # Implementation from existing get_project_setup_prompt()
        pass

    def _get_metadata_prompt(self) -> str:
        # Implementation from existing metadata prompt generation
        pass

    def _generate_domain_association(self, domain: str) -> dict:
        # Implementation from existing generate_domain_association()
        pass
