'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef, use } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/components/ui/use-toast';
import { FileExplorer } from '@/components/file-explorer';
import { AgentProgress, type AgentStep } from '@/components/AgentProgress';
import { SandboxTerminal } from '@/components/SandboxTerminal';
import { 
  ArrowLeft, 
  Send, 
  Loader2, 
  RefreshCw,
  ExternalLink,
  Monitor,
  Tablet,
  Smartphone,
  Play,
  Square,
  Rocket,
  Eye,
  Code,
  Save,
  X,
  History,
  RotateCcw,
  Github,
  GitBranch,
  ChevronUp,
  RefreshCcw,
  Terminal,
  Undo2,
  Redo2,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Link from 'next/link';
import { cn } from '@/lib/utils';

// Chat Mode type
type ChatMode = 'chat' | 'agent';

interface FileAction {
  path: string;
  action: 'created' | 'updated' | 'deleted';
  name: string;
}

interface ThinkingContent {
  content: string;
  timestamp: Date;
}

// File change history for undo/redo
interface FileChange {
  id: string;
  timestamp: Date;
  path: string;
  action: 'created' | 'updated' | 'deleted';
  beforeContent: string | null; // null for created files
  afterContent: string | null;  // null for deleted files
  messageId?: string; // Link to the message that caused this change
}

// Partial response for error recovery
interface PartialResponse {
  messageId: string;
  content: string;
  filesCreated: string[];
  timestamp: Date;
  wasInterrupted: boolean;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  filesCreated?: string[];  // Track files created by this message
  fileActions?: FileAction[]; // Detailed file actions with create/update/delete status
  isCodeResponse?: boolean; // Flag for responses that generated code
  error?: boolean; // Flag for error responses
  mode?: ChatMode; // Track which mode the message was sent in
  thinkingContent?: ThinkingContent[]; // Store thinking/planning output
  wasRecovered?: boolean; // Flag for recovered partial responses
}

interface GitCommit {
  hash: string;
  date: string;
  message: string;
  author_name: string;
}

interface GitHubStatus {
  isConnected: boolean;
  githubUsername?: string;
  repoUrl?: string;
  repoName?: string;
}

// Helper function to extract chat-friendly message (without full code blocks)
function formatChatMessage(content: string, filesCreated?: string[]): string {
  // Check if this is a code generation response
  const hasCodeBlock = /```[\s\S]*?```/.test(content);
  
  if (!hasCodeBlock) {
    return content;
  }
  
  // Extract just the description before the first code block
  const beforeCode = content.split(/```/)[0].trim();
  
  // Also try to extract any text after all code blocks
  const parts = content.split(/```[\s\S]*?```/);
  const afterCode = parts.length > 1 ? parts[parts.length - 1].trim() : '';
  
  // Build a clean message with description
  let cleanMessage = beforeCode || "I've generated the code for you.";
  
  // If there's meaningful text after code, include it (but not if it's just "### FILE:" headers)
  if (afterCode && !afterCode.startsWith('### FILE:') && afterCode.length > 10) {
    cleanMessage += '\n\n' + afterCode;
  }
  
  // Add file info if available
  if (filesCreated && filesCreated.length > 0) {
    cleanMessage += `\n\n📁 **Files created/updated:**\n${filesCreated.map(f => `- \`${f}\``).join('\n')}`;
    cleanMessage += `\n\n✅ Code saved to your project. Check the **Code Editor** to view the changes.`;
  }
  
  return cleanMessage;
}

// ============= DIFF MODAL COMPONENT =============
interface DiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  change: FileChange | null;
}

function DiffModal({ isOpen, onClose, change }: DiffModalProps) {
  if (!isOpen || !change) return null;

  // Simple diff rendering - split content by lines and compare
  const beforeLines = change.beforeContent?.split('\n') || [];
  const afterLines = change.afterContent?.split('\n') || [];
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-card border rounded-xl shadow-2xl w-[90vw] max-w-5xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-muted/50">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-primary" />
            <div>
              <h3 className="font-semibold text-lg">{change.path}</h3>
              <p className="text-sm text-muted-foreground">
                {change.action === 'created' ? '✅ Created' : 
                 change.action === 'updated' ? '📝 Updated' : 
                 '🗑️ Deleted'} 
                • {new Date(change.timestamp).toLocaleTimeString()}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Diff Content */}
        <div className="flex-1 overflow-auto">
          {change.action === 'created' ? (
            // Show only the new content for created files
            <div className="p-4">
              <div className="mb-2 text-sm font-medium text-green-400 flex items-center gap-2">
                <span className="px-2 py-0.5 bg-green-500/20 rounded">New File</span>
              </div>
              <pre className="text-sm font-mono bg-green-500/5 border border-green-500/20 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-words">
                {change.afterContent || '(empty file)'}
              </pre>
            </div>
          ) : change.action === 'deleted' ? (
            // Show only the deleted content
            <div className="p-4">
              <div className="mb-2 text-sm font-medium text-red-400 flex items-center gap-2">
                <span className="px-2 py-0.5 bg-red-500/20 rounded">Deleted</span>
              </div>
              <pre className="text-sm font-mono bg-red-500/5 border border-red-500/20 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-words line-through opacity-75">
                {change.beforeContent || '(empty file)'}
              </pre>
            </div>
          ) : (
            // Side-by-side diff for updated files
            <div className="grid grid-cols-2 divide-x h-full">
              {/* Before */}
              <div className="flex flex-col">
                <div className="p-2 bg-red-500/10 text-red-400 text-sm font-medium sticky top-0 border-b">
                  Before ({beforeLines.length} lines)
                </div>
                <div className="p-2 overflow-auto flex-1">
                  <pre className="text-xs font-mono">
                    {beforeLines.map((line, idx) => {
                      const isRemoved = !afterLines.includes(line);
                      return (
                        <div
                          key={idx}
                          className={cn(
                            "px-2 py-0.5 -mx-2",
                            isRemoved && "bg-red-500/10 text-red-300"
                          )}
                        >
                          <span className="inline-block w-8 text-right mr-3 text-muted-foreground select-none opacity-50">
                            {idx + 1}
                          </span>
                          {line || ' '}
                        </div>
                      );
                    })}
                  </pre>
                </div>
              </div>
              
              {/* After */}
              <div className="flex flex-col">
                <div className="p-2 bg-green-500/10 text-green-400 text-sm font-medium sticky top-0 border-b">
                  After ({afterLines.length} lines)
                </div>
                <div className="p-2 overflow-auto flex-1">
                  <pre className="text-xs font-mono">
                    {afterLines.map((line, idx) => {
                      const isAdded = !beforeLines.includes(line);
                      return (
                        <div
                          key={idx}
                          className={cn(
                            "px-2 py-0.5 -mx-2",
                            isAdded && "bg-green-500/10 text-green-300"
                          )}
                        >
                          <span className="inline-block w-8 text-right mr-3 text-muted-foreground select-none opacity-50">
                            {idx + 1}
                          </span>
                          {line || ' '}
                        </div>
                      );
                    })}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t bg-muted/30 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============= RECOVERY BANNER COMPONENT =============
interface RecoveryBannerProps {
  partialResponse: PartialResponse | null;
  onRecover: () => void;
  onDismiss: () => void;
}

function RecoveryBanner({ partialResponse, onRecover, onDismiss }: RecoveryBannerProps) {
  if (!partialResponse) return null;

  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-3 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
      <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-200">Interrupted Response Detected</p>
        <p className="text-xs text-amber-300/70 mt-0.5">
          A previous response was interrupted. You can recover the partial content.
          {partialResponse.filesCreated.length > 0 && (
            <span> ({partialResponse.filesCreated.length} files were created)</span>
          )}
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onRecover}
          className="text-xs border-amber-500/50 text-amber-200 hover:bg-amber-500/20"
        >
          Recover
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  modified?: boolean;
}

interface OpenTab {
  path: string;
  name: string;
  content: string;
  language: string;
  modified: boolean;
}

const deviceSizes = {
  desktop: { width: '100%', label: 'Desktop' },
  tablet: { width: '768px', label: 'Tablet' },
  mobile: { width: '375px', label: 'Mobile' },
};

export default function ProjectBuilderPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  
  // Unwrap params using React.use()
  const unwrappedParams = use(params);
  const projectId = unwrappedParams.projectId;
  
  const [project, setProject] = useState<{
    id: string;
    name: string;
    description?: string;
    framework: string;
    gitRepoPath?: string;
    status: string;
    containerId?: string;
    containerPort?: number;
  } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentMessage, setCurrentMessage] = useState('');
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<'stopped' | 'starting' | 'running' | 'error'>('stopped');
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [previewKey, setPreviewKey] = useState(0);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploymentUrl, setDeploymentUrl] = useState<string | null>(null);
  
  // New states for toggle view and VS Code-like editing
  const [viewMode, setViewMode] = useState<'preview' | 'code' | 'terminal'>('preview');
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [terminalSessionId, setTerminalSessionId] = useState<string | null>(null);
  
  // Git history states
  const [showGitHistory, setShowGitHistory] = useState(false);
  const [gitCommits, setGitCommits] = useState<GitCommit[]>([]);
  const [isLoadingCommits, setIsLoadingCommits] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  
  // GitHub integration states
  const [githubStatus, setGithubStatus] = useState<GitHubStatus>({ isConnected: false });
  const [isPushingToGithub, setIsPushingToGithub] = useState(false);
  const [isSyncingToGithub, setIsSyncingToGithub] = useState(false);
  
  // Agent progress states
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  
  // Chat mode state
  const [chatMode, setChatMode] = useState<ChatMode>('chat');
  
  // File change history for undo/redo
  const [fileChangeHistory, setFileChangeHistory] = useState<FileChange[]>([]);
  const [undoStack, setUndoStack] = useState<FileChange[]>([]);
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [selectedDiff, setSelectedDiff] = useState<FileChange | null>(null);
  
  // Partial response recovery
  const [partialResponse, setPartialResponse] = useState<PartialResponse | null>(null);
  const [showRecoveryBanner, setShowRecoveryBanner] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session) {
      fetchProject();
      fetchFiles();
      fetchConversationHistory();
      checkPreviewStatus();
      fetchGitHubStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, projectId]);

  // Scroll to bottom when messages change, but with a small delay to ensure content is rendered
  useEffect(() => {
    const timer = setTimeout(() => {
      scrollToBottom();
    }, 100);
    return () => clearTimeout(timer);
  }, [messages, currentMessage, agentSteps]);

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    // Also scroll the scroll area container if available
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  };

  const fetchGitHubStatus = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/github`);
      if (response.ok) {
        const data = await response.json();
        setGithubStatus(data);
      }
    } catch (error) {
      console.error('Error fetching GitHub status:', error);
    }
  };

  const fetchGitCommits = async () => {
    setIsLoadingCommits(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/git?action=log`);
      if (response.ok) {
        const data = await response.json();
        setGitCommits(data.commits || []);
      }
    } catch (error) {
      console.error('Error fetching git commits:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch commit history',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingCommits(false);
    }
  };

  const handleRevertToCommit = async (commitSha: string, commitMessage: string) => {
    if (!confirm(`Revert to commit: "${commitMessage}"? This will discard all changes after this commit.`)) {
      return;
    }
    
    setIsReverting(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/git`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revert', commitSha }),
      });

      if (response.ok) {
        toast({
          title: 'Reverted successfully',
          description: `Reverted to: ${commitMessage}`,
        });
        // Refresh files and preview
        fetchFiles();
        setOpenTabs([]);
        setActiveTab(null);
        if (previewStatus === 'running') {
          setTimeout(() => setPreviewKey(prev => prev + 1), 500);
        }
        fetchGitCommits();
      } else {
        throw new Error('Failed to revert');
      }
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to revert to commit',
        variant: 'destructive',
      });
    } finally {
      setIsReverting(false);
    }
  };

  const handlePushToGitHub = async () => {
    setIsPushingToGithub(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/github`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'push' }),
      });

      if (response.ok) {
        const data = await response.json();
        toast({
          title: 'Pushed to GitHub!',
          description: `Repository: ${data.repo.fullName}`,
        });
        fetchGitHubStatus();
      } else {
        const error = await response.json();
        throw new Error(error.error);
      }
    } catch (error) {
      toast({
        title: 'Push failed',
        description: error instanceof Error ? error.message : 'Failed to push to GitHub',
        variant: 'destructive',
      });
    } finally {
      setIsPushingToGithub(false);
    }
  };

  const handleSyncToGitHub = async () => {
    setIsSyncingToGithub(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/github`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      });

      if (response.ok) {
        toast({
          title: 'Synced to GitHub!',
          description: 'Changes pushed successfully',
        });
      } else {
        const error = await response.json();
        throw new Error(error.error);
      }
    } catch (error) {
      toast({
        title: 'Sync failed',
        description: error instanceof Error ? error.message : 'Failed to sync to GitHub',
        variant: 'destructive',
      });
    } finally {
      setIsSyncingToGithub(false);
    }
  };

  // ============= UNDO/REDO FUNCTIONALITY =============
  
  // Track a file change for undo capability
  const trackFileChange = async (
    path: string, 
    action: 'created' | 'updated' | 'deleted',
    beforeContent: string | null,
    afterContent: string | null,
    messageId?: string
  ) => {
    const change: FileChange = {
      id: `change-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      path,
      action,
      beforeContent,
      afterContent,
      messageId,
    };
    
    setFileChangeHistory(prev => [...prev, change]);
    // Clear undo stack when new change is made
    setUndoStack([]);
    
    return change;
  };

  // Undo the last file change
  const handleUndoLastChange = async () => {
    if (fileChangeHistory.length === 0) {
      toast({
        title: 'Nothing to undo',
        description: 'No file changes to undo',
      });
      return;
    }

    const lastChange = fileChangeHistory[fileChangeHistory.length - 1];
    
    try {
      if (lastChange.action === 'created') {
        // Delete the created file
        await fetch(`/api/projects/${projectId}/files/content`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: lastChange.path }),
        });
        toast({
          title: 'Undone: File deleted',
          description: `Removed ${lastChange.path}`,
        });
      } else if (lastChange.action === 'updated' && lastChange.beforeContent !== null) {
        // Restore the previous content
        await fetch(`/api/projects/${projectId}/files/content`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            path: lastChange.path, 
            content: lastChange.beforeContent 
          }),
        });
        toast({
          title: 'Undone: File restored',
          description: `Restored ${lastChange.path} to previous version`,
        });
      } else if (lastChange.action === 'deleted' && lastChange.beforeContent !== null) {
        // Recreate the deleted file
        await fetch(`/api/projects/${projectId}/files/content`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            path: lastChange.path, 
            content: lastChange.beforeContent 
          }),
        });
        toast({
          title: 'Undone: File restored',
          description: `Recreated ${lastChange.path}`,
        });
      }

      // Move to undo stack for redo capability
      setUndoStack(prev => [...prev, lastChange]);
      setFileChangeHistory(prev => prev.slice(0, -1));
      
      // Refresh files and preview
      fetchFiles();
      if (previewStatus === 'running') {
        setTimeout(() => setPreviewKey(prev => prev + 1), 500);
      }
    } catch (error) {
      toast({
        title: 'Undo failed',
        description: error instanceof Error ? error.message : 'Failed to undo change',
        variant: 'destructive',
      });
    }
  };

  // Redo the last undone change
  const handleRedoLastChange = async () => {
    if (undoStack.length === 0) {
      toast({
        title: 'Nothing to redo',
        description: 'No undone changes to redo',
      });
      return;
    }

    const lastUndo = undoStack[undoStack.length - 1];
    
    try {
      if (lastUndo.action === 'created' && lastUndo.afterContent !== null) {
        // Recreate the file
        await fetch(`/api/projects/${projectId}/files/content`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            path: lastUndo.path, 
            content: lastUndo.afterContent 
          }),
        });
        toast({
          title: 'Redone: File created',
          description: `Recreated ${lastUndo.path}`,
        });
      } else if (lastUndo.action === 'updated' && lastUndo.afterContent !== null) {
        // Apply the change again
        await fetch(`/api/projects/${projectId}/files/content`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            path: lastUndo.path, 
            content: lastUndo.afterContent 
          }),
        });
        toast({
          title: 'Redone: File updated',
          description: `Reapplied changes to ${lastUndo.path}`,
        });
      } else if (lastUndo.action === 'deleted') {
        // Delete the file again
        await fetch(`/api/projects/${projectId}/files/content`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: lastUndo.path }),
        });
        toast({
          title: 'Redone: File deleted',
          description: `Deleted ${lastUndo.path} again`,
        });
      }

      // Move back to history
      setFileChangeHistory(prev => [...prev, lastUndo]);
      setUndoStack(prev => prev.slice(0, -1));
      
      // Refresh files and preview
      fetchFiles();
      if (previewStatus === 'running') {
        setTimeout(() => setPreviewKey(prev => prev + 1), 500);
      }
    } catch (error) {
      toast({
        title: 'Redo failed',
        description: error instanceof Error ? error.message : 'Failed to redo change',
        variant: 'destructive',
      });
    }
  };

  // View diff for a specific file change
  const handleViewDiff = (change: FileChange) => {
    setSelectedDiff(change);
    setShowDiffModal(true);
  };

  // ============= ERROR RECOVERY =============
  
  // Save partial response for recovery
  const savePartialResponse = (messageId: string, content: string, filesCreated: string[]) => {
    const partial: PartialResponse = {
      messageId,
      content,
      filesCreated,
      timestamp: new Date(),
      wasInterrupted: true,
    };
    setPartialResponse(partial);
    // Store in localStorage for persistence across refreshes
    try {
      localStorage.setItem(`partial_response_${projectId}`, JSON.stringify(partial));
    } catch {
      // Ignore storage errors
    }
  };

  // Recover partial response
  const recoverPartialResponse = () => {
    if (!partialResponse) return;
    
    const recoveredMessage: Message = {
      id: partialResponse.messageId,
      role: 'assistant',
      content: partialResponse.content + '\n\n*[Response was interrupted - recovered partial content]*',
      createdAt: partialResponse.timestamp,
      filesCreated: partialResponse.filesCreated,
      isCodeResponse: partialResponse.filesCreated.length > 0,
      wasRecovered: true,
    };
    
    setMessages(prev => [...prev, recoveredMessage]);
    setPartialResponse(null);
    setShowRecoveryBanner(false);
    
    // Clear from localStorage
    try {
      localStorage.removeItem(`partial_response_${projectId}`);
    } catch {
      // Ignore storage errors
    }
    
    toast({
      title: 'Response recovered',
      description: 'Partial response has been restored',
    });
  };

  // Dismiss recovery banner
  const dismissRecovery = () => {
    setPartialResponse(null);
    setShowRecoveryBanner(false);
    try {
      localStorage.removeItem(`partial_response_${projectId}`);
    } catch {
      // Ignore
    }
  };

  // Check for partial response on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`partial_response_${projectId}`);
      if (stored) {
        const partial = JSON.parse(stored) as PartialResponse;
        // Only show if less than 1 hour old
        if (new Date().getTime() - new Date(partial.timestamp).getTime() < 3600000) {
          setPartialResponse(partial);
          setShowRecoveryBanner(true);
        } else {
          localStorage.removeItem(`partial_response_${projectId}`);
        }
      }
    } catch {
      // Ignore parse errors
    }
  }, [projectId]);

  const [pendingRetryMessage, setPendingRetryMessage] = useState<string | null>(null);
  
  const handleRetryMessage = (messageContent: string) => {
    // Remove the last assistant message if it exists
    setMessages(prev => {
      const lastMessage = prev[prev.length - 1];
      if (lastMessage?.role === 'assistant') {
        return prev.slice(0, -1);
      }
      return prev;
    });
    
    // Set the pending retry message
    setPendingRetryMessage(messageContent);
  };

  // Handle pending retry message
  useEffect(() => {
    if (pendingRetryMessage && !isStreaming) {
      setInputValue(pendingRetryMessage);
      setPendingRetryMessage(null);
      // Trigger send after a tick to ensure state is updated
      setTimeout(() => {
        const sendBtn = document.querySelector('[data-send-button]') as HTMLButtonElement;
        if (sendBtn && !sendBtn.disabled) {
          sendBtn.click();
        }
      }, 100);
    }
  }, [pendingRetryMessage, isStreaming]);

  const fetchProject = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}`);
      if (response.ok) {
        const data = await response.json();
        setProject(data);
      } else {
        toast({
          title: 'Error',
          description: 'Project not found',
          variant: 'destructive',
        });
        router.push('/dashboard');
      }
    } catch (error) {
      console.error('Error fetching project:', error);
    }
  };

  const fetchConversationHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const convResponse = await fetch(`/api/projects/${projectId}/chat`);
      if (convResponse.ok) {
        const convData = await convResponse.json();
        
        if (convData.conversations && convData.conversations.length > 0) {
          const latestConversation = convData.conversations[0];
          setConversationId(latestConversation.id);
          
          const msgResponse = await fetch(
            `/api/projects/${projectId}/chat?conversationId=${latestConversation.id}`
          );
          
          if (msgResponse.ok) {
            const msgData = await msgResponse.json();
            if (msgData.messages && msgData.messages.length > 0) {
              const loadedMessages: Message[] = msgData.messages.map((msg: { id: string; role: string; content: string; createdAt: string; toolCalls?: Array<{ files?: string[] }> }) => {
                // For assistant messages, format to remove code blocks
                let content = msg.content;
                const filesFromToolCalls = msg.toolCalls?.[0]?.files || [];
                
                if (msg.role === 'assistant') {
                  content = formatChatMessage(msg.content, filesFromToolCalls);
                }
                
                return {
                  id: msg.id,
                  role: msg.role as 'user' | 'assistant',
                  content,
                  createdAt: new Date(msg.createdAt),
                  filesCreated: filesFromToolCalls,
                  isCodeResponse: filesFromToolCalls.length > 0,
                };
              });
              setMessages(loadedMessages);
              
              // Restore the last used chat mode from localStorage or from last message
              try {
                const savedMode = localStorage.getItem(`chat_mode_${projectId}`);
                if (savedMode === 'chat' || savedMode === 'agent') {
                  setChatMode(savedMode);
                }
              } catch {
                // Ignore localStorage errors
              }
            }
          }
        }
      }
    } catch {
      console.error('Error fetching conversation history');
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Persist chat mode to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem(`chat_mode_${projectId}`, chatMode);
    } catch {
      // Ignore localStorage errors
    }
  }, [chatMode, projectId]);

  const fetchFiles = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/files`);
      if (response.ok) {
        const data = await response.json();
        setFiles(data.files || []);
      }
    } catch (error) {
      console.error('Error fetching files:', error);
    }
  };

  const fetchFileContent = async (filePath: string) => {
    // Check if file is already open
    const existingTab = openTabs.find(tab => tab.path === filePath);
    if (existingTab) {
      setActiveTab(filePath);
      setSelectedFile(filePath);
      setViewMode('code');
      return;
    }

    try {
      const response = await fetch(
        `/api/projects/${projectId}/files/content?path=${encodeURIComponent(filePath)}`
      );
      if (response.ok) {
        const data = await response.json();
        const fileName = filePath.split('/').pop() || filePath;
        
        const newTab: OpenTab = {
          path: filePath,
          name: fileName,
          content: data.content,
          language: data.language,
          modified: false,
        };
        
        setOpenTabs(prev => [...prev, newTab]);
        setActiveTab(filePath);
        setSelectedFile(filePath);
        setViewMode('code');
      }
    } catch (error) {
      console.error('Error fetching file content:', error);
      toast({
        title: 'Error',
        description: 'Failed to load file',
        variant: 'destructive',
      });
    }
  };

  const handleTabClose = (path: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const tab = openTabs.find(t => t.path === path);
    
    if (tab?.modified) {
      if (!confirm('You have unsaved changes. Close anyway?')) {
        return;
      }
    }
    
    setOpenTabs(prev => prev.filter(t => t.path !== path));
    
    if (activeTab === path) {
      const remaining = openTabs.filter(t => t.path !== path);
      if (remaining.length > 0) {
        setActiveTab(remaining[remaining.length - 1].path);
        setSelectedFile(remaining[remaining.length - 1].path);
      } else {
        setActiveTab(null);
        setSelectedFile(null);
      }
    }
  };

  const handleEditorChange = (content: string) => {
    setOpenTabs(prev => 
      prev.map(tab => 
        tab.path === activeTab 
          ? { ...tab, content, modified: true }
          : tab
      )
    );
  };

  const handleSaveFile = async () => {
    const currentTab = openTabs.find(t => t.path === activeTab);
    if (!currentTab) return;

    setIsSaving(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/files/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: currentTab.path,
          content: currentTab.content,
        }),
      });

      if (response.ok) {
        setOpenTabs(prev =>
          prev.map(tab =>
            tab.path === activeTab ? { ...tab, modified: false } : tab
          )
        );
        toast({
          title: 'File saved',
          description: `Saved ${currentTab.name}`,
        });
        
        // Refresh preview if running
        if (previewStatus === 'running') {
          setTimeout(() => setPreviewKey(prev => prev + 1), 500);
        }
      } else {
        throw new Error('Failed to save');
      }
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to save file',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + S to save
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSaveFile();
      }
      // Cmd/Ctrl + M to toggle mode
      if ((e.metaKey || e.ctrlKey) && e.key === 'm') {
        e.preventDefault();
        setChatMode(prev => prev === 'chat' ? 'agent' : 'chat');
      }
      // Cmd/Ctrl + P to toggle preview (if not in input)
      if ((e.metaKey || e.ctrlKey) && e.key === 'p' && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setViewMode(prev => prev === 'preview' ? 'code' : 'preview');
      }
      // Cmd/Ctrl + Z to undo file changes (when not in textarea)
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        handleUndoLastChange();
      }
      // Cmd/Ctrl + Shift + Z to redo file changes (when not in textarea)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'z' && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        handleRedoLastChange();
      }
      // Cmd/Ctrl + Y to redo (alternative)
      if ((e.metaKey || e.ctrlKey) && e.key === 'y' && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        handleRedoLastChange();
      }
      // Escape to stop generation
      if (e.key === 'Escape' && isStreaming) {
        e.preventDefault();
        abortControllerRef.current?.abort();
        setIsStreaming(false);
        setCurrentMessage('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, openTabs, isStreaming, fileChangeHistory, undoStack]);

  const checkPreviewStatus = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/preview`);
      if (response.ok) {
        const data = await response.json();
        setPreviewStatus(data.status);
        setPreviewUrl(data.url);
      }
    } catch (error) {
      console.error('Error checking preview status:', error);
    }
  };

  const startPreview = async () => {
    setPreviewStatus('starting');
    toast({
      title: 'Starting preview',
      description: 'Installing dependencies and starting server... This may take 20-30 seconds on first start.',
    });
    
    try {
      const response = await fetch(`/api/projects/${projectId}/preview`, {
        method: 'POST',
      });
      if (response.ok) {
        const data = await response.json();
        setPreviewUrl(data.preview.url);
        pollPreviewStatus();
      } else {
        setPreviewStatus('error');
        toast({
          title: 'Error',
          description: 'Failed to start preview',
          variant: 'destructive',
        });
      }
    } catch {
      setPreviewStatus('error');
      toast({
        title: 'Error',
        description: 'Failed to start preview',
        variant: 'destructive',
      });
    }
  };

  const pollPreviewStatus = async () => {
    const maxAttempts = 30;
    let attempts = 0;
    
    const poll = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/preview`);
        if (response.ok) {
          const data = await response.json();
          setPreviewStatus(data.status);
          
          if (data.status === 'running') {
            setPreviewKey(prev => prev + 1);
            toast({
              title: 'Preview ready',
              description: 'Your app is now running',
            });
            return;
          } else if (data.status === 'error') {
            toast({
              title: 'Preview error',
              description: 'Container failed to start properly',
              variant: 'destructive',
            });
            return;
          }
        }
        
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 2000);
        } else {
          toast({
            title: 'Preview timeout',
            description: 'Taking longer than expected. Check container logs.',
            variant: 'destructive',
          });
          setPreviewStatus('error');
        }
      } catch (error) {
        console.error('Error polling preview status:', error);
      }
    };
    
    setTimeout(poll, 2000);
  };

  const stopPreview = async () => {
    try {
      await fetch(`/api/projects/${projectId}/preview`, {
        method: 'DELETE',
      });
      setPreviewStatus('stopped');
      setPreviewUrl(null);
      toast({
        title: 'Preview stopped',
      });
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to stop preview',
        variant: 'destructive',
      });
    }
  };

  const refreshPreview = () => {
    setPreviewKey(prev => prev + 1);
    toast({
      title: 'Preview refreshed',
    });
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isStreaming) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    setIsStreaming(true);
    setCurrentMessage('');
    setAgentSteps([]); // Reset steps for new message

    const newMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userMessage,
      createdAt: new Date(),
      mode: chatMode,
    };

    setMessages(prev => [...prev, newMessage]);

    // Track content for potential error recovery
    let streamedContent = '';
    const createdFilesList: string[] = [];

    try {
      abortControllerRef.current = new AbortController();
      
      const response = await fetch(`/api/projects/${projectId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: userMessage,
          conversationId: conversationId,
          mode: chatMode,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) throw new Error('Failed to send message');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let assistantContent = '';
      const createdFiles: string[] = [];
      const fileActions: FileAction[] = []; // Track detailed file actions
      const thinkingContents: ThinkingContent[] = []; // Track thinking/planning output
      let buffer = '';  // Buffer for incomplete SSE messages

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Add new chunk to buffer
        buffer += decoder.decode(value, { stream: true });
        
        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';  // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'step') {
                // Handle step updates
                setAgentSteps(prev => [...prev, data as AgentStep]);
              } else if (data.type === 'thinking') {
                // Handle thinking/planning output - add to agent steps for visibility
                const thinkingItem: ThinkingContent = {
                  content: data.content,
                  timestamp: new Date()
                };
                thinkingContents.push(thinkingItem);
                setAgentSteps(prev => [...prev, {
                  type: 'step',
                  step: 'thinking',
                  status: 'complete',
                  message: data.content,
                  icon: '💭'
                } as AgentStep]);
              } else if (data.type === 'status') {
                // Legacy status updates - convert to step format
                setCurrentMessage(data.message || 'Processing...');
              } else if (data.type === 'text' && data.content) {
                // Append streamed text
                assistantContent += data.content;
                streamedContent = assistantContent; // Update for error recovery
                // Show full message while streaming (don't strip content)
                setCurrentMessage(assistantContent);
              } else if (data.type === 'file_created' && chatMode === 'agent') {
                // Only process file events in Agent Mode - ignore in Chat Mode
                if (data.file?.path) {
                  createdFiles.push(data.file.path);
                  createdFilesList.push(data.file.path); // Update for error recovery
                  // Track detailed file action
                  const actionType = data.action === 'updated' ? 'updated' : 'created';
                  fileActions.push({
                    path: data.file.path,
                    action: actionType,
                    name: data.file.name || data.file.path.split('/').pop() || data.file.path
                  });
                  
                  // Track file change for undo capability
                  trackFileChange(
                    data.file.path,
                    actionType,
                    data.beforeContent || null,
                    data.afterContent || null,
                    newMessage.id
                  );
                }
                const actionIcon = data.action === 'updated' ? '📝' : '✅';
                const actionText = data.action === 'updated' ? 'Updated' : 'Created';
                // Show a step for file operation
                setAgentSteps(prev => [...prev, {
                  type: 'step',
                  step: 'file_action',
                  status: 'complete',
                  message: `${actionIcon} ${actionText}: ${data.file?.path || 'file'}`,
                  details: data.action === 'updated' ? 'Modified existing file' : 'New file created',
                  icon: actionIcon
                } as AgentStep]);
                toast({
                  title: `${actionIcon} ${actionText}`,
                  description: data.file?.path || 'file',
                });
              } else if (data.type === 'file_deleted' && chatMode === 'agent') {
                // Only process file events in Agent Mode - ignore in Chat Mode
                if (data.file?.path) {
                  fileActions.push({
                    path: data.file.path,
                    action: 'deleted',
                    name: data.file.name || data.file.path.split('/').pop() || data.file.path
                  });
                  
                  // Track file deletion for undo capability
                  trackFileChange(
                    data.file.path,
                    'deleted',
                    data.beforeContent || null,
                    null,
                    newMessage.id
                  );
                }
                setAgentSteps(prev => [...prev, {
                  type: 'step',
                  step: 'file_action',
                  status: 'complete',
                  message: `🗑️ Deleted: ${data.file?.path || 'file'}`,
                  icon: '🗑️'
                } as AgentStep]);
                toast({
                  title: '🗑️ Deleted',
                  description: data.file?.path || 'file',
                });
              } else if (data.type === 'error') {
                toast({
                  title: 'Error',
                  description: data.error || 'Something went wrong',
                  variant: 'destructive',
                });
              } else if (data.type === 'done') {
                if (data.conversationId) {
                  setConversationId(data.conversationId);
                }
                
                // Clear agent steps after a short delay so completion message is visible
                setTimeout(() => {
                  setAgentSteps([]);
                }, 3000);
                
                // Format the final message - keep more content visible
                const formattedContent = formatChatMessage(assistantContent, createdFiles);
                
                const assistantMessage: Message = {
                  id: Date.now().toString(),
                  role: 'assistant',
                  content: formattedContent,
                  createdAt: new Date(),
                  filesCreated: createdFiles,
                  fileActions: fileActions,
                  isCodeResponse: createdFiles.length > 0,
                  thinkingContent: thinkingContents.length > 0 ? thinkingContents : undefined,
                };
                setMessages(prev => [...prev, assistantMessage]);
                setCurrentMessage('');
                
                if (data.filesCreated > 0) {
                  fetchFiles();
                  setOpenTabs([]);
                  setActiveTab(null);
                  
                  // Auto-refresh preview when files are created/updated
                  if (previewStatus === 'running') {
                    // Small delay to let the file system sync
                    setTimeout(() => {
                      setPreviewKey(prev => prev + 1);
                    }, 500);
                  }
                }
              }
            } catch {
              // Ignore parse errors for incomplete JSON
            }
          }
        }
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name !== 'AbortError') {
        // Save partial response for potential recovery
        if (streamedContent || createdFilesList.length > 0) {
          savePartialResponse(newMessage.id, streamedContent, createdFilesList);
          setShowRecoveryBanner(true);
          toast({
            title: 'Response Interrupted',
            description: 'Partial response saved. You can recover it from the banner above.',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Error',
            description: 'Failed to send message',
            variant: 'destructive',
          });
        }
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleDeploy = async () => {
    setIsDeploying(true);
    toast({
      title: 'Deploying',
      description: 'Building and deploying your app...',
    });

    try {
      const response = await fetch(`/api/projects/${projectId}/deploy`, {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        setDeploymentUrl(data.deployment.url);
        toast({
          title: 'Deployed successfully',
          description: `Your app is live at ${data.deployment.url}`,
        });
      } else {
        const error = await response.json();
        toast({
          title: 'Deployment failed',
          description: error.error || 'Failed to deploy',
          variant: 'destructive',
        });
      }
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to deploy project',
        variant: 'destructive',
      });
    } finally {
      setIsDeploying(false);
    }
  };

  const handleAskAIToModify = (filePath: string) => {
    // Get current file content if available
    const currentTab = openTabs.find(t => t.path === filePath);
    if (currentTab) {
      // Include file content for context
      const codePreview = currentTab.content.length > 500 
        ? currentTab.content.substring(0, 500) + '\n// ... (file continues)'
        : currentTab.content;
      
      setInputValue(`Please modify the file ${filePath}. Here's the current code:\n\n\`\`\`\n${codePreview}\n\`\`\`\n\nI want to: `);
    } else {
      setInputValue(`Please modify the file ${filePath}. I want to: `);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleAskAIWithContext = () => {
    const contextFiles = openTabs
      .filter(tab => tab.content)
      .map(tab => `### FILE: ${tab.path}\n\`\`\`\n${tab.content.substring(0, 300)}${tab.content.length > 300 ? '\n// ...' : ''}\n\`\`\``)
      .join('\n\n');
    
    if (contextFiles) {
      setInputValue(`Here are my current files:\n\n${contextFiles}\n\nPlease: `);
    } else {
      setInputValue('');
    }
  };

  const currentTab = openTabs.find(t => t.path === activeTab);

  if (status === 'loading' || !project) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="border-b bg-card">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <Link href="/dashboard">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            </Link>
            <div>
              <h1 className="text-lg font-semibold">{project.name}</h1>
              <p className="text-sm text-muted-foreground">{project.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {githubStatus.repoUrl && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(githubStatus.repoUrl!, '_blank')}
              >
                <Github className="h-4 w-4 mr-2" />
                View Repo
              </Button>
            )}
            {deploymentUrl && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(deploymentUrl, '_blank')}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                View Live
              </Button>
            )}
            {githubStatus.isConnected && !githubStatus.repoUrl && (
              <Button
                variant="outline"
                size="sm"
                onClick={handlePushToGitHub}
                disabled={isPushingToGithub}
              >
                {isPushingToGithub ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Pushing...
                  </>
                ) : (
                  <>
                    <Github className="h-4 w-4 mr-2" />
                    Push to GitHub
                  </>
                )}
              </Button>
            )}
            <Button onClick={handleDeploy} disabled={isDeploying} size="sm">
              {isDeploying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deploying...
                </>
              ) : (
                <>
                  <Rocket className="h-4 w-4 mr-2" />
                  Deploy
                </>
              )}
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Chat (30%) */}
        <div className="border-r bg-card" style={{ width: '30%' }}>
          <div className="h-full flex flex-col">
            {/* Chat Header with Mode Toggle */}
            <div className="p-3 border-b">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold">AI Assistant</h2>
                <div className="flex items-center gap-1">
                  {/* Undo/Redo Buttons */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleUndoLastChange}
                    disabled={fileChangeHistory.length === 0 || isStreaming}
                    className="h-8 px-2"
                    title={`Undo last change${fileChangeHistory.length > 0 ? ` (${fileChangeHistory.length})` : ''}`}
                  >
                    <Undo2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRedoLastChange}
                    disabled={undoStack.length === 0 || isStreaming}
                    className="h-8 px-2"
                    title={`Redo${undoStack.length > 0 ? ` (${undoStack.length})` : ''}`}
                  >
                    <Redo2 className="h-4 w-4" />
                  </Button>
                  <div className="w-px h-5 bg-border mx-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowGitHistory(!showGitHistory);
                      if (!showGitHistory) {
                        fetchGitCommits();
                      }
                    }}
                    className="h-8 px-2"
                    title="View commit history"
                  >
                    <History className="h-4 w-4" />
                  </Button>
                  {githubStatus.isConnected ? (
                    githubStatus.repoUrl ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleSyncToGitHub}
                        disabled={isSyncingToGithub}
                        className="h-8 px-2"
                        title="Sync to GitHub"
                      >
                        {isSyncingToGithub ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                      </Button>
                    ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handlePushToGitHub}
                      disabled={isPushingToGithub}
                      className="h-8 px-2"
                      title="Push to GitHub"
                    >
                      {isPushingToGithub ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Github className="h-4 w-4" />
                      )}
                    </Button>
                  )
                ) : null}
                </div>
              </div>
            </div>
            
            {/* Git History Panel */}
            {showGitHistory && (
              <div className="border-b bg-muted/30 p-3 max-h-48 overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4" />
                    <span className="text-sm font-medium">Commit History</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowGitHistory(false)}
                    className="h-6 w-6 p-0"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                </div>
                
                {githubStatus.repoUrl && (
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <Github className="h-3 w-3" />
                    <a
                      href={githubStatus.repoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {githubStatus.repoName}
                    </a>
                  </div>
                )}
                
                <ScrollArea className="h-32">
                  {isLoadingCommits ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  ) : gitCommits.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">No commits yet</p>
                  ) : (
                    <div className="space-y-2">
                      {gitCommits.slice(0, 10).map((commit, index) => (
                        <div
                          key={commit.hash}
                          className="flex items-start justify-between gap-2 p-2 rounded bg-background hover:bg-muted/50 group"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{commit.message}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(commit.date).toLocaleDateString()} · {commit.hash.slice(0, 7)}
                            </p>
                          </div>
                          {index > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRevertToCommit(commit.hash, commit.message)}
                              disabled={isReverting}
                              className="h-6 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Revert to this commit"
                            >
                              {isReverting ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3 w-3" />
                              )}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>
            )}
            
            <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
              <div className="space-y-4 pb-4">
                {/* Recovery Banner - show when there's a partial response to recover */}
                {showRecoveryBanner && partialResponse && (
                  <RecoveryBanner
                    partialResponse={partialResponse}
                    onRecover={recoverPartialResponse}
                    onDismiss={dismissRecovery}
                  />
                )}
                
                {isLoadingHistory ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8 space-y-4">
                    {chatMode === 'chat' ? (
                      <>
                        <div className="text-4xl">💬</div>
                        <div>
                          <p className="font-medium text-foreground">Chat Mode (Planning)</p>
                          <p className="text-sm mt-1">Tell me what you want to build - let&apos;s plan together</p>
                          <p className="text-xs mt-2 text-muted-foreground/70">Switch to Agent Mode (🤖) when ready to write code</p>
                        </div>
                        <div className="flex flex-wrap justify-center gap-2 pt-2">
                          {['Personal blog', 'Portfolio', 'Landing page', 'Dashboard'].map((suggestion) => (
                            <button
                              key={suggestion}
                              onClick={() => setInputValue(`I want to build a ${suggestion.toLowerCase()}`)}
                              className="text-xs px-3 py-1.5 rounded-full bg-muted hover:bg-muted/80 transition-colors"
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-4xl">🛠️</div>
                        <div>
                          <p className="font-medium text-foreground">Build Mode</p>
                          <p className="text-sm mt-1">Tell me what to implement</p>
                        </div>
                        <div className="flex flex-wrap justify-center gap-2 pt-2">
                          {['Create homepage', 'Add navigation', 'Build contact form', 'Add dark mode'].map((suggestion) => (
                            <button
                              key={suggestion}
                              onClick={() => setInputValue(suggestion)}
                              className="text-xs px-3 py-1.5 rounded-full bg-muted hover:bg-muted/80 transition-colors"
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  messages.map((message, index) => (
                    <div
                      key={message.id}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-lg p-3 ${
                          message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                        }`}
                      >
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {message.content}
                          </ReactMarkdown>
                        </div>
                        {/* Show quick actions for code responses */}
                        {message.role === 'assistant' && message.filesCreated && message.filesCreated.length > 0 && (
                          <div className="mt-3 pt-2 border-t border-border/50">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs text-muted-foreground">📁 Files modified:</p>
                              {/* View all changes button */}
                              {fileChangeHistory.some(c => c.messageId === message.id) && (
                                <button
                                  onClick={() => {
                                    const changes = fileChangeHistory.filter(c => c.messageId === message.id);
                                    if (changes.length > 0) {
                                      handleViewDiff(changes[0]);
                                    }
                                  }}
                                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                                >
                                  <Eye className="h-3 w-3" />
                                  View Changes
                                </button>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {(message.fileActions || message.filesCreated?.map(f => ({ 
                                path: f, 
                                action: 'created' as const, 
                                name: f.split('/').pop() || f 
                              })) || []).map((fileAction) => {
                                const actionIcon = fileAction.action === 'updated' ? '📝' : 
                                                   fileAction.action === 'deleted' ? '🗑️' : '✅';
                                const actionColor = fileAction.action === 'updated' ? 'border-yellow-500/50 bg-yellow-500/10' :
                                                    fileAction.action === 'deleted' ? 'border-red-500/50 bg-red-500/10' : 
                                                    'border-green-500/50 bg-green-500/10';
                                
                                // Find change for this file to enable diff view
                                const fileChange = fileChangeHistory.find(
                                  c => c.path === fileAction.path && c.messageId === message.id
                                );
                                
                                return (
                                  <div key={fileAction.path} className="flex items-center gap-1">
                                    <button
                                      onClick={() => {
                                        if (fileAction.action !== 'deleted') {
                                          fetchFileContent(fileAction.path);
                                          setViewMode('code');
                                        }
                                      }}
                                      disabled={fileAction.action === 'deleted'}
                                      className={`text-xs px-2 py-1 rounded-l border flex items-center gap-1 transition-colors ${actionColor} ${fileAction.action !== 'deleted' ? 'hover:bg-background cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                                      title={`${fileAction.action === 'updated' ? 'Modified' : fileAction.action === 'deleted' ? 'Deleted' : 'Created'}: ${fileAction.path}`}
                                    >
                                      <span>{actionIcon}</span>
                                      <Code className="h-3 w-3" />
                                      <span>{fileAction.name}</span>
                                    </button>
                                    {/* Diff button for this file */}
                                    {fileChange && (
                                      <button
                                        onClick={() => handleViewDiff(fileChange)}
                                        className={`text-xs px-1.5 py-1 rounded-r border-y border-r transition-colors ${actionColor} hover:bg-background`}
                                        title="View diff"
                                      >
                                        <Eye className="h-3 w-3" />
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {/* Retry button for user messages */}
                        {message.role === 'user' && index === messages.length - 2 && !isStreaming && (
                          <div className="mt-2 pt-2 border-t border-border/50">
                            <button
                              onClick={() => handleRetryMessage(message.content)}
                              className="text-xs px-2 py-1 bg-background/50 hover:bg-background rounded border flex items-center gap-1 transition-colors"
                            >
                              <RefreshCcw className="h-3 w-3" />
                              Retry
                            </button>
                          </div>
                        )}
                        {/* Retry button for the last assistant message */}
                        {message.role === 'assistant' && index === messages.length - 1 && !isStreaming && messages.length >= 2 && (
                          <div className="mt-2 pt-2 border-t border-border/50 flex gap-2">
                            <button
                              onClick={() => {
                                const userMessage = messages[messages.length - 2];
                                if (userMessage?.role === 'user') {
                                  handleRetryMessage(userMessage.content);
                                }
                              }}
                              className="text-xs px-2 py-1 bg-background/50 hover:bg-background rounded border flex items-center gap-1 transition-colors"
                            >
                              <RefreshCcw className="h-3 w-3" />
                              Regenerate response
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
                
                {/* Agent Progress Steps - Always visible inline display */}
                {(isStreaming || agentSteps.length > 0) && (
                  <div className="mb-4">
                    <AgentProgress
                      steps={agentSteps}
                      isStreaming={isStreaming}
                    />
                  </div>
                )}
                
                {/* Streaming message display - In Agent Mode, only show description, not code */}
                {isStreaming && currentMessage && (
                  <div className="flex justify-start">
                    <div className="max-w-[95%] rounded-lg p-3 bg-muted overflow-auto">
                      <div className="prose prose-sm dark:prose-invert max-w-none break-words">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {chatMode === 'agent' 
                            ? formatChatMessage(currentMessage, []) 
                            : currentMessage}
                        </ReactMarkdown>
                      </div>
                      <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />
                    </div>
                  </div>
                )}
                
                {/* Loading indicator when no message yet - only show if no steps */}
                {isStreaming && !currentMessage && agentSteps.length === 0 && (
                  <div className="flex justify-start">
                    <div className="rounded-lg p-3 bg-muted flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">Thinking...</span>
                    </div>
                  </div>
                )}
                
                {/* Extra padding at the bottom to ensure content isn't cut off */}
                <div ref={messagesEndRef} className="h-4" />
              </div>
            </ScrollArea>

            <div className="p-4 border-t">
              <div className="flex gap-3">
                {/* Left: Input textarea */}
                <div className="flex-1">
                  <textarea
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder={chatMode === 'chat' 
                      ? "What do you want to build?"
                      : "What should I implement?"
                    }
                    disabled={isStreaming}
                    className="w-full h-full min-h-[76px] max-h-[200px] resize-none px-3 py-2 text-sm rounded-lg border border-input bg-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    rows={2}
                  />
                </div>
                
                {/* Right: Symmetric controls */}
                <div className="flex flex-col gap-1.5 w-[72px]">
                  {/* Mode Switch - matches button width */}
                  <div className="relative flex items-center bg-muted rounded-lg p-0.5 h-9">
                    <div 
                      className={`absolute h-8 w-[34px] bg-primary rounded-md transition-transform duration-200 ease-out ${
                        chatMode === 'agent' ? 'translate-x-[34px]' : 'translate-x-0'
                      }`}
                    />
                    <button
                      onClick={() => setChatMode('chat')}
                      className={`relative z-10 flex-1 h-8 flex items-center justify-center text-sm transition-colors duration-200 rounded-md ${
                        chatMode === 'chat' ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                      }`}
                      title="Chat - Plan your project"
                    >
                      💬
                    </button>
                    <button
                      onClick={() => setChatMode('agent')}
                      className={`relative z-10 flex-1 h-8 flex items-center justify-center text-sm transition-colors duration-200 rounded-md ${
                        chatMode === 'agent' ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                      }`}
                      title="Build - Generate code"
                    >
                      🤖
                    </button>
                  </div>
                  
                  {/* Send/Stop Button - full width */}
                  {isStreaming ? (
                    <Button
                      onClick={() => {
                        abortControllerRef.current?.abort();
                        setIsStreaming(false);
                        setCurrentMessage('');
                      }}
                      variant="destructive"
                      className="w-full h-9"
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      onClick={handleSendMessage}
                      disabled={!inputValue.trim()}
                      className="w-full h-9"
                      data-send-button="true"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {isStreaming 
                  ? '⏳ Generating... Click stop button to cancel' 
                  : chatMode === 'chat'
                    ? '� Chat Mode: Plan and discuss your project. Switch to 🤖 to write code.'
                    : '🤖 Agent Mode: I will write code and modify files. Switch to 💬 to plan.'
                }
              </p>
            </div>
          </div>
        </div>

        {/* Right Panel - Toggle between Preview and Code Editor (70%) */}
        <div className="bg-background flex-1" style={{ width: '70%' }}>
          <div className="h-full flex flex-col">
            {/* Toggle Header */}
            <div className="p-2 border-b flex items-center justify-between bg-card">
              <div className="flex items-center gap-2">
                {/* Toggle Buttons */}
                <div className="flex bg-muted rounded-lg p-1">
                  <Button
                    variant={viewMode === 'preview' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode('preview')}
                    className="gap-2"
                  >
                    <Eye className="h-4 w-4" />
                    Live Preview
                  </Button>
                  <Button
                    variant={viewMode === 'code' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode('code')}
                    className="gap-2"
                  >
                    <Code className="h-4 w-4" />
                    Code Editor
                  </Button>
                  <Button
                    variant={viewMode === 'terminal' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode('terminal')}
                    className="gap-2"
                  >
                    <Terminal className="h-4 w-4" />
                    Terminal
                  </Button>
                </div>

                {/* Preview Controls - only show in preview mode */}
                {viewMode === 'preview' && (
                  <div className="flex gap-1 ml-4">
                    {(['desktop', 'tablet', 'mobile'] as const).map((device) => (
                      <Button
                        key={device}
                        variant={previewDevice === device ? 'secondary' : 'ghost'}
                        size="sm"
                        onClick={() => setPreviewDevice(device)}
                      >
                        {device === 'desktop' && <Monitor className="h-4 w-4" />}
                        {device === 'tablet' && <Tablet className="h-4 w-4" />}
                        {device === 'mobile' && <Smartphone className="h-4 w-4" />}
                      </Button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                {viewMode === 'preview' ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={refreshPreview}
                      disabled={previewStatus !== 'running'}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    {previewUrl && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(`/api/projects/${projectId}/preview/proxy?path=/`, '_blank')}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    )}
                    {previewStatus === 'running' ? (
                      <Button variant="outline" size="sm" onClick={stopPreview}>
                        <Square className="h-4 w-4 mr-2" />
                        Stop
                      </Button>
                    ) : (
                      <Button size="sm" onClick={startPreview} disabled={previewStatus === 'starting'}>
                        {previewStatus === 'starting' ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4 mr-2" />
                        )}
                        Start
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    {currentTab?.modified && (
                      <Button
                        size="sm"
                        onClick={handleSaveFile}
                        disabled={isSaving}
                        className="gap-2"
                      >
                        {isSaving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                        Save
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden">
              {viewMode === 'preview' ? (
                /* Live Preview */
                <div className="h-full flex items-center justify-center bg-muted/20 relative">
                  {/* Blur overlay during agent execution */}
                  {isStreaming && (
                    <div className="absolute inset-0 z-10 bg-background/50 backdrop-blur-sm flex items-center justify-center">
                      <div className="bg-card border rounded-lg p-4 shadow-lg flex items-center gap-3">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        <div>
                          <p className="font-medium text-sm">Agent is working...</p>
                          <p className="text-xs text-muted-foreground">Preview will refresh when done</p>
                        </div>
                      </div>
                    </div>
                  )}
                  {previewStatus === 'running' && previewUrl ? (
                    <div
                      className={cn(
                        "h-full bg-white transition-all duration-300",
                        isStreaming && "opacity-50"
                      )}
                      style={{ width: deviceSizes[previewDevice].width }}
                    >
                      <iframe
                        key={previewKey}
                        ref={iframeRef}
                        src={`/api/projects/${projectId}/preview/proxy?path=/`}
                        className="w-full h-full border-0"
                        title="Preview"
                      />
                    </div>
                  ) : (
                    <div className="text-center p-8">
                      <p className="text-muted-foreground mb-4">
                        {previewStatus === 'starting' ? 'Starting preview...' : 'Preview not running'}
                      </p>
                      {previewStatus !== 'starting' && (
                        <Button onClick={startPreview}>
                          <Play className="h-4 w-4 mr-2" />
                          Start Preview
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ) : viewMode === 'terminal' ? (
                /* Terminal View */
                <div className="h-full bg-zinc-950">
                  {project?.containerId ? (
                    <SandboxTerminal
                      sessionId={terminalSessionId || project.containerId}
                      className="h-full rounded-none"
                      onError={(error) => {
                        toast({
                          title: 'Terminal Error',
                          description: error,
                          variant: 'destructive',
                        });
                      }}
                    />
                  ) : (
                    <div className="h-full flex items-center justify-center text-zinc-400">
                      <div className="text-center space-y-4">
                        <Terminal className="h-12 w-12 mx-auto opacity-50" />
                        <p>Start the preview to enable terminal access</p>
                        <Button
                          variant="outline"
                          onClick={startPreview}
                          disabled={previewStatus === 'starting'}
                        >
                          {previewStatus === 'starting' ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4 mr-2" />
                          )}
                          Start Preview
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Code Editor with File Explorer */
                <div className="h-full flex">
                  {/* File Explorer Sidebar */}
                  <div className="w-64 border-r bg-card overflow-hidden flex flex-col">
                    <div className="p-2 border-b text-sm font-semibold text-muted-foreground">
                      EXPLORER
                    </div>
                    <ScrollArea className="flex-1">
                      <FileExplorer
                        files={files}
                        selectedFile={selectedFile}
                        onFileSelect={fetchFileContent}
                      />
                    </ScrollArea>
                  </div>

                  {/* Editor Area */}
                  <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Tabs */}
                    {openTabs.length > 0 && (
                      <div className="flex border-b bg-muted/30 overflow-x-auto">
                        {openTabs.map((tab) => (
                          <div
                            key={tab.path}
                            className={`flex items-center gap-2 px-3 py-2 border-r cursor-pointer text-sm ${
                              activeTab === tab.path
                                ? 'bg-background border-b-2 border-b-primary'
                                : 'hover:bg-muted/50'
                            }`}
                            onClick={() => {
                              setActiveTab(tab.path);
                              setSelectedFile(tab.path);
                            }}
                          >
                            <span className={tab.modified ? 'italic' : ''}>
                              {tab.name}
                              {tab.modified && ' •'}
                            </span>
                            <button
                              onClick={(e) => handleTabClose(tab.path, e)}
                              className="hover:bg-muted rounded p-0.5"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Editor Content */}
                    <div className="flex-1 overflow-hidden">
                      {currentTab ? (
                        <div className="h-full flex flex-col">
                          <div className="flex items-center justify-between p-2 border-b bg-muted/30">
                            <span className="text-sm font-mono text-muted-foreground">
                              {currentTab.path}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleAskAIToModify(currentTab.path)}
                              className="gap-2 text-xs"
                            >
                              Ask AI to modify
                            </Button>
                          </div>
                          <div className="flex-1 overflow-hidden relative">
                            <textarea
                              ref={editorRef}
                              value={currentTab.content}
                              onChange={(e) => handleEditorChange(e.target.value)}
                              className="absolute inset-0 w-full h-full p-4 font-mono text-sm bg-[#1e1e1e] text-[#d4d4d4] resize-none focus:outline-none"
                              style={{
                                lineHeight: '1.5',
                                tabSize: 2,
                              }}
                              spellCheck={false}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="h-full flex items-center justify-center text-muted-foreground">
                          <div className="text-center">
                            <Code className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>Select a file from the explorer to edit</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Diff Modal */}
      <DiffModal
        isOpen={showDiffModal}
        onClose={() => {
          setShowDiffModal(false);
          setSelectedDiff(null);
        }}
        change={selectedDiff}
      />
    </div>
  );
}
