/**
 * Docker Sandbox Preview Component
 * Displays component previews in isolated Docker containers
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, RefreshCw, X, AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DockerSandboxPreviewProps {
  code: string;
  sessionId?: string;
  onSessionIdChange?: (sessionId: string) => void;
  onError?: (error: string) => void;
}

type SandboxStatus = 'idle' | 'creating' | 'starting' | 'healthy' | 'unhealthy' | 'error';

interface SandboxInfo {
  sessionId: string;
  previewUrl: string;
  status: SandboxStatus;
  port: number;
}

export function DockerSandboxPreview({
  code,
  sessionId: initialSessionId,
  onSessionIdChange,
  onError,
}: DockerSandboxPreviewProps) {
  const [status, setStatus] = useState<SandboxStatus>('idle');
  const [sandboxInfo, setSandboxInfo] = useState<SandboxInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const healthCheckInterval = useRef<NodeJS.Timeout | null>(null);

  /**
   * Add log entry
   */
  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${timestamp}] ${message}`]);
  }, []);

  /**
   * Create or connect to sandbox
   */
  const createSandbox = useCallback(async () => {
    try {
      setStatus('creating');
      setError(null);
      addLog('Creating sandbox container...');

      const response = await fetch('/api/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          sessionId: initialSessionId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to create sandbox');
      }

      addLog(`Sandbox created: ${data.sessionId}`);
      addLog(`Preview URL: ${data.previewUrl}`);

      setSandboxInfo({
        sessionId: data.sessionId,
        previewUrl: data.previewUrl,
        status: data.status,
        port: data.port,
      });

      onSessionIdChange?.(data.sessionId);
      setStatus(data.status);

      // Start health checking
      startHealthCheck(data.sessionId);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      setStatus('error');
      addLog(`Error: ${errorMessage}`);
      onError?.(errorMessage);
    }
  }, [code, initialSessionId, onSessionIdChange, onError, addLog]);

  /**
   * Check sandbox health
   */
  const checkHealth = useCallback(async (sessionId: string) => {
    try {
      const response = await fetch(`/api/sandbox?sessionId=${sessionId}`);
      const data = await response.json();

      if (response.ok) {
        setStatus(data.status);
        
        if (data.status === 'healthy' && status !== 'healthy') {
          addLog('Sandbox is healthy and ready');
          
          // Stop health checking once healthy
          if (healthCheckInterval.current) {
            clearInterval(healthCheckInterval.current);
            healthCheckInterval.current = null;
          }
        }
      }
    } catch (err) {
      console.error('Health check failed:', err);
    }
  }, [status, addLog]);

  /**
   * Start periodic health checking
   */
  const startHealthCheck = useCallback(
    (sessionId: string) => {
      // Clear existing interval
      if (healthCheckInterval.current) {
        clearInterval(healthCheckInterval.current);
      }

      // Check immediately
      checkHealth(sessionId);

      // Check every 2 seconds
      healthCheckInterval.current = setInterval(() => {
        checkHealth(sessionId);
      }, 2000);
    },
    [checkHealth]
  );

  /**
   * Destroy sandbox
   */
  const destroySandbox = useCallback(async () => {
    if (!sandboxInfo) return;

    try {
      addLog('Destroying sandbox...');
      setStatus('idle');

      const response = await fetch(
        `/api/sandbox?sessionId=${sandboxInfo.sessionId}`,
        { method: 'DELETE' }
      );

      if (response.ok) {
        addLog('Sandbox destroyed successfully');
        setSandboxInfo(null);
        setError(null);
      }
    } catch (err) {
      console.error('Failed to destroy sandbox:', err);
    }
  }, [sandboxInfo, addLog]);

  /**
   * Restart sandbox with updated code
   */
  const restartSandbox = useCallback(async () => {
    await destroySandbox();
    await createSandbox();
  }, [destroySandbox, createSandbox]);

  /**
   * Initialize sandbox on mount
   */
  useEffect(() => {
    if (initialSessionId) {
      // Try to connect to existing sandbox
      addLog('Connecting to existing sandbox...');
      checkHealth(initialSessionId).then(() => {
        if (status !== 'healthy') {
          createSandbox();
        }
      });
    } else {
      createSandbox();
    }

    // Cleanup on unmount
    return () => {
      if (healthCheckInterval.current) {
        clearInterval(healthCheckInterval.current);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Render status indicator
   */
  const renderStatusIndicator = () => {
    switch (status) {
      case 'creating':
      case 'starting':
        return (
          <div className="flex items-center space-x-2 text-blue-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">
              {status === 'creating' ? 'Creating container...' : 'Starting server...'}
            </span>
          </div>
        );
      case 'healthy':
        return (
          <div className="flex items-center space-x-2 text-green-600">
            <CheckCircle className="w-4 h-4" />
            <span className="text-sm">Ready</span>
          </div>
        );
      case 'unhealthy':
      case 'error':
        return (
          <div className="flex items-center space-x-2 text-red-600">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">Error</span>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 rounded-lg overflow-hidden border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b">
        <div className="flex items-center space-x-4">
          <h3 className="font-semibold text-gray-900">Docker Preview</h3>
          {renderStatusIndicator()}
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={restartSandbox}
            disabled={status === 'creating' || status === 'starting'}
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            Restart
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={destroySandbox}
            disabled={!sandboxInfo}
          >
            <X className="w-4 h-4 mr-1" />
            Destroy
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative">
        {/* Loading State */}
        {(status === 'creating' || status === 'starting') && (
          <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
            <div className="text-center space-y-4">
              <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto" />
              <div>
                <h4 className="font-semibold text-gray-900">
                  {status === 'creating'
                    ? 'Creating Docker Container'
                    : 'Starting Next.js Server'}
                </h4>
                <p className="text-sm text-gray-600 mt-2">
                  This may take up to 30 seconds...
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Error State */}
        {status === 'error' && error && (
          <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
            <div className="text-center space-y-4 max-w-md px-4">
              <AlertCircle className="w-12 h-12 text-red-600 mx-auto" />
              <div>
                <h4 className="font-semibold text-gray-900">Failed to Create Sandbox</h4>
                <p className="text-sm text-red-600 mt-2">{error}</p>
              </div>
              <Button onClick={createSandbox}>Try Again</Button>
            </div>
          </div>
        )}

        {/* Preview iframe */}
        {sandboxInfo && status === 'healthy' && (
          <iframe
            ref={iframeRef}
            src={sandboxInfo.previewUrl}
            className="w-full h-full border-0"
            title="Component Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          />
        )}
      </div>

      {/* Logs Panel */}
      {logs.length > 0 && (
        <div className="border-t bg-gray-900 text-gray-100 p-3 max-h-32 overflow-y-auto">
          <div className="text-xs font-mono space-y-1">
            {logs.map((log, index) => (
              <div key={index}>{log}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
