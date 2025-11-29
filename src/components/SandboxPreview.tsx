/**
 * Unified Sandbox Preview Component
 * Automatically chooses between Docker or Sandpack based on availability
 */

'use client';

import { useState, useEffect } from 'react';
import { DockerSandboxPreview } from './DockerSandboxPreview';
import { AlertCircle } from 'lucide-react';

interface SandboxPreviewProps {
  code: string;
  sessionId?: string;
  onSessionIdChange?: (sessionId: string) => void;
  onError?: (error: string) => void;
  preferDocker?: boolean;
}

export function SandboxPreview({
  code,
  sessionId,
  onSessionIdChange,
  onError,
  preferDocker = true,
}: SandboxPreviewProps) {
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);
  const [dockerEnabled, setDockerEnabled] = useState<boolean>(false);
  const [checking, setChecking] = useState(true);

  /**
   * Check Docker availability
   */
  useEffect(() => {
    async function checkDocker() {
      try {
        const response = await fetch('/api/sandbox/status');
        const data = await response.json();
        
        setDockerEnabled(data.enabled);
        setDockerAvailable(data.available);
      } catch (error) {
        console.error('Failed to check Docker availability:', error);
        setDockerAvailable(false);
        setDockerEnabled(false);
      } finally {
        setChecking(false);
      }
    }

    checkDocker();
  }, []);

  // Show loading state while checking
  if (checking) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 rounded-lg border">
        <div className="text-center">
          <div className="animate-pulse text-gray-600">
            Checking preview system...
          </div>
        </div>
      </div>
    );
  }

  // Use Docker if available and enabled
  if (dockerEnabled && dockerAvailable && preferDocker) {
    return (
      <DockerSandboxPreview
        code={code}
        sessionId={sessionId}
        onSessionIdChange={onSessionIdChange}
        onError={onError}
      />
    );
  }

  // Fallback: Show message about Docker not being available
  // In a real implementation, you would integrate Sandpack here
  return (
    <div className="flex items-center justify-center h-full bg-gray-50 rounded-lg border">
      <div className="text-center space-y-4 max-w-md px-4">
        <AlertCircle className="w-12 h-12 text-yellow-600 mx-auto" />
        <div>
          <h4 className="font-semibold text-gray-900">Docker Preview Unavailable</h4>
          <p className="text-sm text-gray-600 mt-2">
            {!dockerEnabled
              ? 'Docker previews are not enabled. Set DOCKER_ENABLED=true in your environment.'
              : 'Docker is not running. Please start Docker Desktop to use container-based previews.'}
          </p>
          {/* In production, you would render Sandpack here as fallback */}
          <p className="text-xs text-gray-500 mt-4">
            Fallback to browser-based preview would appear here.
          </p>
        </div>
      </div>
    </div>
  );
}
