'use client';

import { useSession, signOut, signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { Plus, BrainCircuit, LogOut, Settings, Trash2, Search, Loader2, ExternalLink, Code, Zap, Github, Check, AlertCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Project {
  id: string;
  name: string;
  description: string;
  template: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

function Sidebar({ user }: { user: { name?: string | null; email?: string | null; githubUsername?: string | null } }) {
  const isGitHubConnected = !!user?.githubUsername;
  
  const handleConnectGitHub = async () => {
    await signIn('github', { callbackUrl: '/dashboard' });
  };

  return (
    <aside className="w-64 flex-shrink-0 border-r bg-background flex flex-col">
      <div className="p-4 border-b">
        <Link href="/dashboard" className="flex items-center space-x-2">
          <BrainCircuit className="h-8 w-8 text-primary" />
          <span className="text-xl font-bold">AI App Builder</span>
        </Link>
      </div>
      <nav className="flex-1 p-4 space-y-2">
        <Link href="/dashboard" className="flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium bg-muted">
          <span>My Projects</span>
        </Link>
        <Link href="/settings" className="flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted">
          <Settings className="h-4 w-4" />
          <span>Settings</span>
        </Link>
        
        {/* GitHub Connection Status */}
        <div className="pt-4 mt-4 border-t">
          <div className="px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Integrations</p>
            {isGitHubConnected ? (
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <Github className="h-4 w-4" />
                <span className="flex-1">@{user.githubUsername}</span>
                <Check className="h-4 w-4" />
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={handleConnectGitHub}
              >
                <Github className="h-4 w-4 mr-2" />
                Connect GitHub
              </Button>
            )}
          </div>
        </div>
      </nav>
      <div className="p-4 border-t">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center font-bold">
            {user?.name?.[0].toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="font-semibold">{user?.name}</div>
            <div className="text-xs text-muted-foreground">{user?.email}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => signOut({ callbackUrl: '/' })}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}

function ProjectCard({ project, onDelete }: { project: Project, onDelete: (id: string) => void }) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this project? This action cannot be undone.')) {
      return;
    }
    setIsDeleting(true);
    await onDelete(project.id);
  };

  return (
    <Card className="flex flex-col">
      <CardHeader className="p-4">
        <CardTitle className="text-base font-semibold">{project.name}</CardTitle>
        <CardDescription className="text-xs truncate h-8">{project.description || 'No description'}</CardDescription>
      </CardHeader>
      <CardContent className="p-4 flex-grow">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center space-x-2">
            <Zap className="h-3 w-3 text-yellow-500" />
            <span>{project.template}</span>
          </div>
          <div className="text-right">
            Updated {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })}
          </div>
        </div>
      </CardContent>
      <CardFooter className="p-4 flex justify-between items-center bg-muted/50">
        <Button variant="destructive" size="icon" onClick={handleDelete} disabled={isDeleting}>
          {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
        <div className="flex space-x-2">
          <Button size="sm" variant="outline" asChild>
            <Link href={`/sandbox/${project.id}`} target="_blank">
              <ExternalLink className="mr-1 h-3 w-3" />
              Preview
            </Link>
          </Button>
          <Button size="sm" asChild>
            <Link href={`/builder/${project.id}`}>
              <Code className="mr-1 h-3 w-3" />
              Builder
            </Link>
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

interface GitHubRepoInfo {
  name: string;
  fullName: string;
  description?: string;
  owner: string;
  isPrivate: boolean;
  defaultBranch: string;
  language?: string;
  stargazersCount: number;
  htmlUrl: string;
  isPreviewSupported?: boolean;
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [newProjectTemplate, setNewProjectTemplate] = useState('nextjs');
  
  // GitHub import state
  const [createMode, setCreateMode] = useState<'template' | 'github'>('template');
  const [githubUrl, setGithubUrl] = useState('');
  const [isValidatingUrl, setIsValidatingUrl] = useState(false);
  const [githubRepoInfo, setGithubRepoInfo] = useState<GitHubRepoInfo | null>(null);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [autoStartPreview, setAutoStartPreview] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
    if (status === 'authenticated') {
      fetchProjects();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, router]);

  // Debounced GitHub URL validation
  useEffect(() => {
    if (createMode !== 'github' || !githubUrl.trim()) {
      setGithubRepoInfo(null);
      setGithubError(null);
      return;
    }

    const timer = setTimeout(() => {
      validateGitHubUrl(githubUrl);
    }, 500);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [githubUrl, createMode]);

  const validateGitHubUrl = async (url: string) => {
    setIsValidatingUrl(true);
    setGithubError(null);
    setGithubRepoInfo(null);

    try {
      const response = await fetch('/api/github/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();

      if (data.valid) {
        setGithubRepoInfo(data.repo);
        // Auto-fill project name if empty
        if (!newProjectName && data.repo?.name) {
          setNewProjectName(data.repo.name);
        }
        // Auto-fill description if empty
        if (!newProjectDescription && data.repo?.description) {
          setNewProjectDescription(data.repo.description);
        }
      } else {
        setGithubError(data.error || 'Invalid repository');
      }
    } catch {
      setGithubError('Failed to validate URL');
    } finally {
      setIsValidatingUrl(false);
    }
  };

  const fetchProjects = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/projects');
      if (response.ok) {
        const data = await response.json();
        setProjects(data);
      } else {
        throw new Error('Failed to fetch projects');
      }
    } catch (error) {
      console.error('Error fetching projects:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch projects. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const createProject = async () => {
    if (!newProjectName.trim()) {
      toast({
        title: 'Project name is required',
        variant: 'destructive',
      });
      return;
    }

    // Validate GitHub URL if in GitHub mode
    if (createMode === 'github') {
      if (!githubUrl.trim()) {
        toast({
          title: 'GitHub URL is required',
          variant: 'destructive',
        });
        return;
      }
      if (githubError || !githubRepoInfo) {
        toast({
          title: 'Invalid GitHub repository',
          description: githubError || 'Please enter a valid GitHub URL',
          variant: 'destructive',
        });
        return;
      }
    }

    setIsCreating(true);
    try {
      const requestBody = createMode === 'github'
        ? {
            source: 'github',
            name: newProjectName,
            description: newProjectDescription,
            githubUrl: githubUrl.trim(),
            autoStartPreview,
          }
        : {
            source: 'template',
            name: newProjectName,
            description: newProjectDescription,
            template: newProjectTemplate,
          };

      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        const newProject = await response.json();
        setProjects([newProject, ...projects]);
        
        const message = createMode === 'github'
          ? `${newProject.name} has been imported from GitHub.`
          : `${newProject.name} has been successfully created.`;
        
        toast({
          title: createMode === 'github' ? 'Repository Imported' : 'Project Created',
          description: message,
        });
        
        // Reset form
        resetCreateForm();
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create project');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An error occurred';
      toast({
        title: 'Error Creating Project',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const resetCreateForm = () => {
    setIsCreateModalOpen(false);
    setNewProjectName('');
    setNewProjectDescription('');
    setNewProjectTemplate('nextjs');
    setCreateMode('template');
    setGithubUrl('');
    setGithubRepoInfo(null);
    setGithubError(null);
    setAutoStartPreview(true);
  };

  const deleteProject = async (id: string) => {
    try {
      const response = await fetch(`/api/projects/${id}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setProjects(projects.filter((p) => p.id !== id));
        toast({
          title: 'Project Deleted',
          description: 'The project has been successfully deleted.',
        });
      } else {
        throw new Error('Failed to delete project');
      }
    } catch {
      toast({
        title: 'Error Deleting Project',
        description: 'An error occurred while deleting the project.',
        variant: 'destructive',
      });
    }
  };

  const filteredProjects = useMemo(() => {
    return projects.filter((p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchQuery, projects]);

  if (status === 'loading' || !session) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-muted/40">
      <Sidebar user={session.user} />
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="border-b bg-background">
          <div className="container mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold">My Projects</h1>
              <div className="flex items-center space-x-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search projects..."
                    className="pl-10"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <Button onClick={() => setIsCreateModalOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" /> New Project
                </Button>
              </div>
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(3)].map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader><div className="h-6 bg-muted rounded w-3/4"></div></CardHeader>
                  <CardContent><div className="h-4 bg-muted rounded w-full"></div></CardContent>
                  <CardFooter><div className="h-8 bg-muted rounded w-20 ml-auto"></div></CardFooter>
                </Card>
              ))}
            </div>
          ) : filteredProjects.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredProjects.map((project) => (
                <ProjectCard key={project.id} project={project} onDelete={deleteProject} />
              ))}
            </div>
          ) : (
            <div className="text-center py-20">
              <h2 className="text-2xl font-semibold mb-2">No projects found</h2>
              <p className="text-muted-foreground mb-4">
                {searchQuery ? `No projects match your search for "${searchQuery}".` : "Get started by creating your first project."}
              </p>
              <Button onClick={() => setIsCreateModalOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> Create Project
              </Button>
            </div>
          )}
        </div>
      </main>

      <Dialog open={isCreateModalOpen} onOpenChange={(open) => {
        if (!open) resetCreateForm();
        else setIsCreateModalOpen(true);
      }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Create a New Project</DialogTitle>
            <DialogDescription>
              Start from a template or import an existing GitHub repository.
            </DialogDescription>
          </DialogHeader>
          
          <Tabs value={createMode} onValueChange={(v: string) => setCreateMode(v as 'template' | 'github')} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="template" className="flex items-center gap-2">
                <Code className="h-4 w-4" />
                Template
              </TabsTrigger>
              <TabsTrigger value="github" className="flex items-center gap-2">
                <Github className="h-4 w-4" />
                Import from GitHub
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="template" className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="name">Project Name</Label>
                <Input
                  id="name"
                  placeholder="e.g., My Awesome App"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  placeholder="A brief description of your project"
                  value={newProjectDescription}
                  onChange={(e) => setNewProjectDescription(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="template">Template</Label>
                <Select value={newProjectTemplate} onValueChange={setNewProjectTemplate}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a template" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nextjs">Next.js</SelectItem>
                    <SelectItem value="vite-react">Vite + React</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>
            
            <TabsContent value="github" className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="github-url">GitHub Repository URL</Label>
                <div className="relative">
                  <Input
                    id="github-url"
                    placeholder="https://github.com/owner/repo"
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    className={githubError ? 'border-red-500 pr-10' : githubRepoInfo ? 'border-green-500 pr-10' : ''}
                  />
                  {isValidatingUrl && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                  {!isValidatingUrl && githubRepoInfo && (
                    <Check className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />
                  )}
                  {!isValidatingUrl && githubError && (
                    <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-red-500" />
                  )}
                </div>
                {githubError && (
                  <p className="text-sm text-red-500 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {githubError}
                  </p>
                )}
                {githubRepoInfo && (
                  <div className="rounded-md bg-muted p-3 text-sm space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{githubRepoInfo.fullName}</span>
                      {githubRepoInfo.isPrivate && (
                        <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">Private</span>
                      )}
                    </div>
                    {githubRepoInfo.description && (
                      <p className="text-muted-foreground text-xs">{githubRepoInfo.description}</p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {githubRepoInfo.language && <span>{githubRepoInfo.language}</span>}
                      <span>⭐ {githubRepoInfo.stargazersCount}</span>
                    </div>
                    {githubRepoInfo.isPreviewSupported === false && (
                      <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-xs text-yellow-800 dark:text-yellow-200">
                        <AlertCircle className="inline h-3 w-3 mr-1" />
                        <strong>Note:</strong> This appears to be a {githubRepoInfo.language} project. 
                        Live preview is only available for JavaScript/TypeScript projects (Next.js, React, Vite).
                        You can still import and browse the code.
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="import-name">Project Name</Label>
                <Input
                  id="import-name"
                  placeholder="e.g., My Imported App"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="import-description">Description (optional)</Label>
                <Input
                  id="import-description"
                  placeholder="A brief description of your project"
                  value={newProjectDescription}
                  onChange={(e) => setNewProjectDescription(e.target.value)}
                />
              </div>
              
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="auto-preview"
                  checked={autoStartPreview && githubRepoInfo?.isPreviewSupported !== false}
                  onChange={(e) => setAutoStartPreview(e.target.checked)}
                  disabled={githubRepoInfo?.isPreviewSupported === false}
                  className="h-4 w-4 rounded border-gray-300 disabled:opacity-50"
                />
                <Label 
                  htmlFor="auto-preview" 
                  className={`text-sm font-normal cursor-pointer ${githubRepoInfo?.isPreviewSupported === false ? 'text-muted-foreground' : ''}`}
                >
                  Start preview automatically after import
                  {githubRepoInfo?.isPreviewSupported === false && ' (not available for this project)'}
                </Label>
              </div>
            </TabsContent>
          </Tabs>
          
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={resetCreateForm} disabled={isCreating}>
              Cancel
            </Button>
            <Button 
              onClick={createProject} 
              disabled={isCreating || (createMode === 'github' && (!githubRepoInfo || !!githubError))}
            >
              {isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {isCreating 
                ? (createMode === 'github' ? 'Importing...' : 'Creating...') 
                : (createMode === 'github' ? 'Import Repository' : 'Create Project')
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
