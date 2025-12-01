'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, use } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { 
  ArrowLeft, 
  Loader2, 
  RefreshCw,
  ExternalLink,
  Monitor,
  Tablet,
  Smartphone,
  Play,
  Square,
  AlertCircle,
  Code,
} from 'lucide-react';
import Link from 'next/link';

type ViewportSize = 'desktop' | 'tablet' | 'mobile';

interface Project {
  id: string;
  name: string;
  description?: string;
  template: string;
  status: string;
  gitRepoPath?: string;
  containerPort?: number;
}

interface PreviewStatus {
  url?: string;
  port?: number;
  status: 'stopped' | 'starting' | 'running' | 'error';
  error?: string;
}

export default function SandboxPage({ 
  params 
}: { 
  params: Promise<{ projectId: string }> 
}) {
  const { projectId } = use(params);
  const { status: authStatus } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  
  const [project, setProject] = useState<Project | null>(null);
  const [preview, setPreview] = useState<PreviewStatus>({ status: 'stopped' });
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [viewport, setViewport] = useState<ViewportSize>('desktop');
  const [iframeKey, setIframeKey] = useState(0);

  // Auth check
  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/login');
    }
  }, [authStatus, router]);

  // Fetch project details
  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    
    const fetchProject = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}`);
        if (!response.ok) {
          if (response.status === 404) {
            toast({
              title: 'Project not found',
              description: 'The project you are looking for does not exist.',
              variant: 'destructive',
            });
            router.push('/dashboard');
            return;
          }
          throw new Error('Failed to fetch project');
        }
        const data = await response.json();
        setProject(data);
      } catch (error) {
        console.error('Error fetching project:', error);
        toast({
          title: 'Error',
          description: 'Failed to load project details.',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchProject();
  }, [projectId, authStatus, router, toast]);

  // Fetch preview status
  useEffect(() => {
    if (!project) return;

    const fetchPreviewStatus = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/preview`);
        if (response.ok) {
          const data = await response.json();
          if (data.preview) {
            setPreview({
              url: data.preview.url,
              port: data.preview.port,
              status: data.preview.status || 'running',
            });
          } else {
            setPreview({ status: 'stopped' });
          }
        }
      } catch (error) {
        console.error('Error fetching preview status:', error);
      }
    };

    fetchPreviewStatus();
    
    // Poll for status updates
    const interval = setInterval(fetchPreviewStatus, 5000);
    return () => clearInterval(interval);
  }, [project, projectId]);

  const startPreview = async () => {
    setIsStarting(true);
    setPreview({ status: 'starting' });
    
    try {
      const response = await fetch(`/api/projects/${projectId}/preview`, {
        method: 'POST',
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || data.message || 'Failed to start preview');
      }
      
      setPreview({
        url: data.preview.url,
        port: data.preview.port,
        status: 'running',
      });
      
      toast({
        title: 'Preview Started',
        description: `Preview is running on port ${data.preview.port}`,
      });
    } catch (error) {
      console.error('Error starting preview:', error);
      const message = error instanceof Error ? error.message : 'Failed to start preview';
      setPreview({ status: 'error', error: message });
      toast({
        title: 'Error Starting Preview',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsStarting(false);
    }
  };

  const stopPreview = async () => {
    setIsStopping(true);
    
    try {
      const response = await fetch(`/api/projects/${projectId}/preview`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Failed to stop preview');
      }
      
      setPreview({ status: 'stopped' });
      toast({
        title: 'Preview Stopped',
        description: 'The preview container has been stopped.',
      });
    } catch (error) {
      console.error('Error stopping preview:', error);
      toast({
        title: 'Error',
        description: 'Failed to stop preview.',
        variant: 'destructive',
      });
    } finally {
      setIsStopping(false);
    }
  };

  const refreshPreview = () => {
    setIframeKey(prev => prev + 1);
  };

  const getViewportClass = () => {
    switch (viewport) {
      case 'tablet':
        return 'max-w-[768px]';
      case 'mobile':
        return 'max-w-[375px]';
      default:
        return 'w-full';
    }
  };

  if (authStatus === 'loading' || isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">Project Not Found</h2>
          <p className="text-muted-foreground mb-4">The project could not be loaded.</p>
          <Button asChild>
            <Link href="/dashboard">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Dashboard
              </Link>
            </Button>
            <div className="h-4 w-px bg-border" />
            <div>
              <h1 className="font-semibold">{project.name}</h1>
              <p className="text-xs text-muted-foreground">{project.template}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Viewport Switcher */}
            <div className="flex items-center border rounded-md">
              <Button
                variant={viewport === 'desktop' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setViewport('desktop')}
                className="rounded-r-none"
              >
                <Monitor className="h-4 w-4" />
              </Button>
              <Button
                variant={viewport === 'tablet' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setViewport('tablet')}
                className="rounded-none border-x"
              >
                <Tablet className="h-4 w-4" />
              </Button>
              <Button
                variant={viewport === 'mobile' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setViewport('mobile')}
                className="rounded-l-none"
              >
                <Smartphone className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="h-4 w-px bg-border" />
            
            {/* Preview Controls */}
            {preview.status === 'running' ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={refreshPreview}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(preview.url, '_blank')}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={stopPreview}
                  disabled={isStopping}
                >
                  {isStopping ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Square className="h-4 w-4 mr-2" />
                  )}
                  Stop
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                onClick={startPreview}
                disabled={isStarting || preview.status === 'starting'}
              >
                {isStarting || preview.status === 'starting' ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Start Preview
              </Button>
            )}
            
            <div className="h-4 w-px bg-border" />
            
            <Button variant="outline" size="sm" asChild>
              <Link href={`/builder/${projectId}`}>
                <Code className="h-4 w-4 mr-2" />
                Builder
              </Link>
            </Button>
          </div>
        </div>
      </header>
      
      {/* Preview Area */}
      <main className="flex-1 p-4 bg-muted/40 overflow-hidden">
        <div className={`h-full mx-auto transition-all duration-300 ${getViewportClass()}`}>
          {preview.status === 'stopped' && (
            <div className="h-full flex items-center justify-center bg-background rounded-lg border">
              <div className="text-center p-8">
                <Monitor className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
                <h2 className="text-xl font-semibold mb-2">Preview Not Running</h2>
                <p className="text-muted-foreground mb-6 max-w-md">
                  Start the preview to see your application running in a live container.
                </p>
                <Button onClick={startPreview} disabled={isStarting}>
                  {isStarting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Start Preview
                </Button>
              </div>
            </div>
          )}
          
          {preview.status === 'starting' && (
            <div className="h-full flex items-center justify-center bg-background rounded-lg border">
              <div className="text-center p-8">
                <Loader2 className="h-16 w-16 mx-auto mb-4 text-primary animate-spin" />
                <h2 className="text-xl font-semibold mb-2">Starting Preview...</h2>
                <p className="text-muted-foreground">
                  Setting up the container and installing dependencies.
                </p>
              </div>
            </div>
          )}
          
          {preview.status === 'error' && (
            <div className="h-full flex items-center justify-center bg-background rounded-lg border">
              <div className="text-center p-8">
                <AlertCircle className="h-16 w-16 mx-auto mb-4 text-destructive" />
                <h2 className="text-xl font-semibold mb-2">Preview Error</h2>
                <p className="text-muted-foreground mb-4 max-w-md">
                  {preview.error || 'An error occurred while starting the preview.'}
                </p>
                <Button onClick={startPreview} disabled={isStarting}>
                  {isStarting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Try Again
                </Button>
              </div>
            </div>
          )}
          
          {preview.status === 'running' && preview.url && (
            <div className="h-full bg-background rounded-lg border overflow-hidden shadow-lg">
              <iframe
                key={iframeKey}
                src={preview.url}
                className="w-full h-full border-0"
                title={`Preview of ${project.name}`}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              />
            </div>
          )}
        </div>
      </main>
      
      {/* Status Bar */}
      <footer className="border-t bg-background px-4 py-2">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-2">
              <span 
                className={`h-2 w-2 rounded-full ${
                  preview.status === 'running' 
                    ? 'bg-green-500' 
                    : preview.status === 'starting' 
                    ? 'bg-yellow-500 animate-pulse' 
                    : preview.status === 'error'
                    ? 'bg-red-500'
                    : 'bg-gray-400'
                }`} 
              />
              {preview.status === 'running' && 'Preview running'}
              {preview.status === 'starting' && 'Starting...'}
              {preview.status === 'stopped' && 'Preview stopped'}
              {preview.status === 'error' && 'Error'}
            </span>
            {preview.port && (
              <span>Port: {preview.port}</span>
            )}
          </div>
          <div>
            {viewport === 'desktop' && 'Desktop View'}
            {viewport === 'tablet' && 'Tablet View (768px)'}
            {viewport === 'mobile' && 'Mobile View (375px)'}
          </div>
        </div>
      </footer>
    </div>
  );
}
