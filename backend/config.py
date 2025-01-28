GITHUB = {
    "ORG_NAME": "frameception-v2",
    "TEMPLATE_REPO": "https://github.com/hellno/farcaster-frames-template.git",
    "COMMIT_NAME": "hellno",
    "COMMIT_EMAIL": "686075+hellno@users.noreply.github.com",
    "DEFAULT_DESCRIPTION": "A new Farcaster frameception project",
}

APP_NAME = "frameception"
MODAL_UPDATE_CODE_FUNCTION_NAME = "update_code"
MODAL_CREATE_PROJECT_FUNCTION_NAME = "create_project"

TIMEOUTS = {
    "CODE_UPDATE": 1200,  # 20 mins
    "PROJECT_SETUP": 3600,  # 1 hour
    "BUILD": 600,  # 10 mins
}

VOLUMES = {
    "GITHUB_REPOS": "frameception-github-repos",
    "SHARED_NODE_MODULES": "frameception-shared-node-modules",
    "PNPM_STORE": "frameception-pnpm-store",
}

PATHS = {
    "GITHUB_REPOS": "/github-repos",
    "SHARED_NODE_MODULES": "/shared/node_modules",
    "PNPM_STORE": "/pnpm-store",
}

AIDER_CONFIG = {
    "MODEL": {
        "model": "sonnet",
        # "model": "r1", # deepseek has API issues right now :(
        # "editor_model": "deepseek/deepseek-chat",
        # "weak_model": "deepseek/deepseek-chat",
    },
    "CODER": {"verbose": True, "cache_prompts": True},
}

BASE_MOUNT = "/s3-projects"
BUCKET_NAME = "frameception-projects-prod"  # Hardcoded bucket name
