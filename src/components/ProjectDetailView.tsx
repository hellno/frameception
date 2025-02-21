"use client";

import { useEffect, useState, useCallback } from "react";

declare module "next-auth" {
  interface Session {
    posthog?: {
      identified: boolean;
    };
  }
}
import { ConversationMessage } from "./ConversationMessage";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { ProjectStatusIndicator } from "./ProjectStatusIndicator";
import {
  getMergedProjectStatus,
  ProjectStatus,
  VercelBuildStatus,
} from "~/lib/types/project-status";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";
import {
  GitBranch,
  ArrowUp,
  Share,
  ExternalLink,
  Copy,
  Play,
} from "lucide-react";
import { Button } from "./ui/button";
import sdk from "@farcaster/frame-sdk";
import { Log, Project, UserContext, VercelLogData } from "~/lib/types";
import Link from "next/link";
import { useFrameSDK } from "~/hooks/useFrameSDK";

const styles = {
  card: "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700",
  cardHeader: "px-6 py-4 border-b border-gray-100 dark:border-gray-700",
  cardContent: "p-6",
  deploymentStatus: {
    ready: "text-green-600 bg-green-50 dark:bg-green-900/20",
    error: "text-red-600 bg-red-50 dark:bg-red-900/20",
    building: "text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20",
    pending: "text-blue-600 bg-blue-50 dark:bg-blue-900/20",
  },
  badge:
    "px-2.5 py-0.5 rounded-full text-xs font-medium inline-flex items-center gap-1",
  link: "text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 inline-flex items-center gap-2 transition-colors",
  chat: {
    userMessage: "bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg break-words",
    botMessage: "bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg break-words",
    timestamp: "text-xs text-gray-500 mt-1",
    container: "space-y-4",
  },
};

interface ProjectDetailViewProps {
  projectId: string | null;
}

function ProjectInfoCard({
  project,
  projectStatus,
  onHandleDeploy,
  isSubmitting,
}: {
  project: Project;
  projectStatus: ProjectStatus;
  onHandleDeploy: () => void;
  isSubmitting: boolean;
}) {
  const handleCopyUrl = async () => {
    if (project.frontend_url) {
      try {
        await navigator.clipboard.writeText(project.frontend_url);
        console.log("URL copied to clipboard");
      } catch (err) {
        console.error("Failed to copy URL:", err);
      }
    }
  };

  const handleShare = () => {
    if (project.frontend_url) {
      const shareText = `Check out my frame "${project.name}" built with frameception`;
      const shareUrl = `https://warpcast.com/~/compose?text=${encodeURIComponent(
        shareText
      )}&embeds[]=${encodeURIComponent(project.frontend_url)}`;
      sdk.actions.openUrl(shareUrl);
    }
  };

  return (
    <div className={styles.card}>
      <div className="p-6 space-y-6">
        <div className="flex flex-row sm:items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
              {project.name}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Created {new Date(project.created_at).toLocaleDateString()}
            </p>
          </div>
          <ProjectStatusIndicator status={projectStatus} />
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          {projectStatus.state === "created" && (
            <Button
              onClick={onHandleDeploy}
              className="flex-1 w-full"
              variant="default"
              disabled={isSubmitting}
            >
              <Play className="w-4 h-4 mr-2" />
              Deploy Now
            </Button>
          )}
          {project.frontend_url && (
            <>
              <Link href={project.frontend_url} className="flex-1 w-full">
                <Button variant="outline" className="w-full">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open Frame
                </Button>
              </Link>
              {projectStatus.state === "deployed" && (
                <>
                  <Button
                    variant="outline"
                    onClick={handleShare}
                    className="flex-1"
                  >
                    <Share className="w-4 h-4 mr-2" />
                    Share on Warpcast
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleCopyUrl}
                    className="flex-1"
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    Copy URL
                  </Button>
                </>
              )}
            </>
          )}
          {project.repo_url && (
            <Link href={project.repo_url} className="flex-1 w-full">
              <Button variant="outline" className="w-full">
                <GitBranch className="w-4 h-4 mr-2" />
                Show GitHub
              </Button>
            </Link>
          )}
        </div>
        {projectStatus.error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 dark:text-red-400 text-sm">
            {projectStatus.error}
          </div>
        )}
      </div>
    </div>
  );
}

function ConversationCard({
  project,
  logs,
  updatePrompt,
  setUpdatePrompt,
  isSubmitting,
  handleSubmitUpdate,
  userContext,
  vercelBuildStatus,
  onHandleTryAutofix,
}: {
  project: Project;
  logs: Log[];
  updatePrompt: string;
  setUpdatePrompt: (prompt: string) => void;
  isSubmitting: boolean;
  handleSubmitUpdate: () => void;
  userContext?: UserContext;
  vercelBuildStatus: VercelBuildStatus | null;
  onHandleTryAutofix: () => void;
}) {
  const jobs =
    project.jobs
      ?.filter(
        (job) => job.type === "update_code" || job.type === "setup_project"
      )
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ) || [];

  const hasAnyJobsPending = jobs.some((job) => job.status === "pending");
  const hasBuildErrors = vercelBuildStatus === "ERROR";

  const buildErrorLog = logs
    .filter((log) => log.source === "vercel" && log.data)
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conversation</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4 max-w-full">
          <div className="space-y-4 max-w-full">
            {hasAnyJobsPending && (
              <div className="p-4 bg-gray-50 rounded-lg text-sm text-gray-500">
                There are pending jobs for this project. Please wait for them to
                finish.
              </div>
            )}
            {!hasAnyJobsPending && (
              <>
                <textarea
                  rows={4}
                  value={updatePrompt}
                  onChange={(e) => setUpdatePrompt(e.target.value)}
                  placeholder="Describe the changes you'd like to make..."
                  className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 break-words overflow-wrap-anywhere"
                  disabled={isSubmitting || hasAnyJobsPending}
                />
                <Button
                  onClick={handleSubmitUpdate}
                  disabled={
                    !updatePrompt.trim() ||
                    isSubmitting ||
                    !userContext ||
                    hasAnyJobsPending
                  }
                  className="w-full flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Updating...
                    </>
                  ) : (
                    <>
                      Update Frame
                      <ArrowUp className="w-4 h-4" />
                    </>
                  )}
                </Button>
              </>
            )}
            {hasBuildErrors && (
              <div className="grid grid-cols-2 gap-4">
                <Button
                  onClick={onHandleTryAutofix}
                  disabled={isSubmitting || hasAnyJobsPending}
                  className="w-full"
                >
                  Try Autofix
                </Button>
                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="outline" className="w-full">
                      View Build Errors
                    </Button>
                  </SheetTrigger>
                  <SheetContent className="w-[400px] sm:w-[540px] lg:w-[680px] overflow-y-auto flex flex-col h-full">
                    <div className="flex-none">
                      <SheetHeader>
                        <SheetTitle>Build Error Details</SheetTitle>
                        <SheetDescription>
                          {new Date(buildErrorLog.created_at).toLocaleString()}
                        </SheetDescription>
                      </SheetHeader>
                    </div>
                    {buildErrorLog?.data?.logs && (
                      <LogViewer logs={buildErrorLog.data.logs} />
                    )}
                  </SheetContent>
                </Sheet>
              </div>
            )}
          </div>
          {jobs.length > 0 ? (
            jobs.map((job) => (
              <div key={job.id} className="space-y-2">
                <ConversationMessage
                  text={job.data.prompt}
                  timestamp={new Date(job.created_at).toLocaleString()}
                  type="user"
                />
                <ConversationMessage
                  text={
                    job.status === "pending"
                      ? "Processing..."
                      : job.data.error
                      ? job.data.error
                      : job.data.result || ""
                  }
                  timestamp={new Date(job.created_at).toLocaleString()}
                  type="bot"
                  isError={!!job.data.error}
                />
              </div>
            ))
          ) : (
            <div className="text-center text-gray-500 py-8">
              No conversations yet. Start by describing the changes you&apos;d
              like to make.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function LogViewer({ logs }: { logs: VercelLogData[] }) {
  const [showAllLogs, setShowAllLogs] = useState(false);

  const processedLogs = logs
    ? logs
        .filter(
          (log) =>
            showAllLogs ||
            (log.type === "stderr" && !log.payload?.text.startsWith("warning"))
        )
        .filter((log) => log.payload?.text?.trim())
        .map((log) => ({
          ...log,
          timestamp: new Date(log.payload.date).toUTCString(),
          isError: log.type === "stderr",
        }))
    : [];

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none p-4 border-b">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Build Logs</h3>
          <label className="flex items-center space-x-2 text-sm">
            <input
              type="checkbox"
              checked={showAllLogs}
              onChange={(e) => setShowAllLogs(e.target.checked)}
              className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
            />
            <span>Show all logs</span>
          </label>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="divide-y divide-gray-100">
          {processedLogs.map((log, index) => (
            <div
              key={log.payload.id || index}
              className={`p-3 ${
                log.isError ? "bg-red-50" : "hover:bg-gray-50"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded ${
                        log.isError
                          ? "bg-red-100 text-red-700"
                          : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {log.type}
                    </span>
                    <span className="text-xs text-gray-500">
                      {log.timestamp}
                    </span>
                  </div>
                  <div
                    className={`mt-1 text-sm font-mono whitespace-pre-wrap break-words ${
                      log.isError ? "text-red-700" : "text-gray-700"
                    }`}
                  >
                    {log.payload.text}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ActivityLogCard({ logs }: { logs: Log[] }) {
  const getSourceColor = (source: string) => {
    const colors: Record<string, string> = {
      frontend: "text-blue-600",
      backend: "text-green-600",
      vercel: "text-purple-600",
      github: "text-gray-600",
      farcaster: "text-pink-600",
      unknown: "text-gray-400",
    };
    return colors[source] || colors.unknown;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Log</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-96 overflow-y-auto border rounded-lg">
          {logs.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              No activity logs yet
            </div>
          ) : (
            <div className="divide-y">
              {logs.map((log) => (
                <div key={log.id} className="p-3 hover:bg-gray-50">
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div
                      className={`text-sm font-medium ${getSourceColor(
                        log.source
                      )}`}
                    >
                      {log.source}
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(log.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="mt-1 text-sm text-gray-700 whitespace-pre-wrap break-words">
                    {log.text}
                    {log.data && log.data.logs && (
                      <Sheet>
                        <SheetTrigger asChild>
                          <button className="ml-2 px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-md transition-colors">
                            View Details
                          </button>
                        </SheetTrigger>
                        <SheetContent className="w-[400px] sm:w-[540px] lg:w-[680px] overflow-y-auto flex flex-col h-full">
                          <div className="flex-none">
                            <SheetHeader>
                              <SheetTitle>Log Details</SheetTitle>
                              <SheetDescription>
                                {new Date(log.created_at).toLocaleString()}
                              </SheetDescription>
                            </SheetHeader>
                          </div>
                          <LogViewer logs={log.data.logs} />
                        </SheetContent>
                      </Sheet>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectDetailView({ projectId }: ProjectDetailViewProps) {
  const { context } = useFrameSDK();
  const userContext = context?.user;
  const [project, setProject] = useState<Project | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [updatePrompt, setUpdatePrompt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deploymentStatus, setDeploymentStatus] = useState<string | null>(null);
  const [vercelBuildStatus, setVercelBuildStatus] =
    useState<VercelBuildStatus | null>(null);

  const projectStatus = getMergedProjectStatus(project);

  const fetchProject = useCallback(async () => {
    if (!projectId) return;
    try {
      const response = await fetch(`/api/projects?id=${projectId}`);
      if (!response.ok) throw new Error("Failed to fetch project");

      const data = await response.json();
      const fetchedProject: Project = data.projects?.[0];
      setProject(fetchedProject);
      if (fetchedProject) {
        const allLogs =
          fetchedProject.jobs?.flatMap((job) => job.logs || []) || [];
        const sortedLogs = allLogs.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

        // Merge new logs with existing Vercel logs
        setLogs((prevLogs) => {
          // Keep existing Vercel logs
          const vercelLogs = prevLogs.filter((log) => log.source === "vercel");

          // Add new logs, avoiding duplicates by ID
          const existingIds = new Set(vercelLogs.map((log) => log.id));
          const newLogs = sortedLogs.filter((log) => !existingIds.has(log.id));

          // Combine and sort all logs
          return [...vercelLogs, ...newLogs].sort(
            (a, b) =>
              new Date(b.created_at).getTime() -
              new Date(a.created_at).getTime()
          );
        });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setError(err.message || "Failed to load project");
    }
  }, [projectId]);

  const fetchVercelStatus = useCallback(async () => {
    if (!project?.vercel_project_id) return;
    try {
      const response = await fetch(`/api/vercel-status/${project.id}`);
      if (!response.ok) throw new Error("Failed to fetch Vercel status");
      const data = await response.json();
      setDeploymentStatus(data.status);
      setVercelBuildStatus(data.status);

      // If status changed, add log entry
      if (data.status !== deploymentStatus) {
        setLogs((prev) => [
          {
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            source: "vercel",
            text: `Deployment status: ${data.status}`,
            data,
          },
          ...prev,
        ]);
      }
    } catch (err) {
      console.error("Error fetching Vercel status:", err);
    }
  }, [project?.vercel_project_id, project?.id, deploymentStatus]);

  // Consolidated polling approach
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (projectId) {
      fetchProject(); // initial fetch
      interval = setInterval(() => {
        fetchProject();
        fetchVercelStatus();
      }, 5000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [projectId, fetchProject, fetchVercelStatus]);

  const handleSubmitUpdate = async () => {
    if (!updatePrompt.trim()) return;
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/update-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          prompt: updatePrompt,
          userContext,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to submit update");
      }
      setUpdatePrompt("");
      await fetchProject();
    } catch (err) {
      console.error("Error submitting update:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const onHandleDeploy = async () => {
    if (!project) return;
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/deploy-project", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: project.id,
          userContext: userContext,
        }),
      });
      if (!response.ok) throw new Error("Deployment failed");
      await fetchProject();
    } catch (err) {
      console.error("Deployment error:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const onHandleTryAutofix = async () => {
    if (!project) return;
    setIsSubmitting(true);

    console.log("logs", logs);
    // Filter logs to get only stderr entries
    const errorLogs = logs
      .filter((log) => log.data?.logs?.some((l) => l.type === "stderr"))
      .flatMap(
        (log) =>
          log.data?.logs &&
          log.data.logs.filter(
            (l) =>
              l.type === "stderr" &&
              l.payload?.text &&
              !l.payload.text.startsWith("warning")
          )
      )
      .map((log) => log?.payload?.text)
      .join("\n");

    const autofixPrompt = `Please fix the following build errors:\n\n${errorLogs}`;
    console.log("Autofix prompt:", autofixPrompt);
    try {
      const response = await fetch("/api/update-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          prompt: autofixPrompt,
          userContext,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to submit autofix update");
      }

      // Refresh project data after update
      await fetchProject();
    } catch (err) {
      console.error("Error submitting autofix:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!project && !error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-500 p-4 text-center break-words max-w-md">
        Error: {error}
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-gray-500 p-4 text-center">Project not found</div>
    );
  }

  return (
    <div className="mx-auto space-y-6 px-4 max-w-sm lg:max-w-4xl xl:max-w-5xl">
      <ProjectInfoCard
        project={project}
        projectStatus={projectStatus}
        onHandleDeploy={onHandleDeploy}
        isSubmitting={isSubmitting}
      />
      <ConversationCard
        project={project}
        logs={logs}
        vercelBuildStatus={vercelBuildStatus}
        updatePrompt={updatePrompt}
        setUpdatePrompt={setUpdatePrompt}
        isSubmitting={isSubmitting}
        handleSubmitUpdate={handleSubmitUpdate}
        onHandleTryAutofix={onHandleTryAutofix}
        userContext={userContext}
      />
      <ActivityLogCard logs={logs} />
    </div>
  );
}

export default ProjectDetailView;
