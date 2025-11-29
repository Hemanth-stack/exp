/**
 * Docker Sandbox Demo Page
 * Test and demonstrate the Docker sandbox system
 */

'use client';

import { useState } from 'react';
import { SandboxPreview } from '@/components/SandboxPreview';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const EXAMPLE_COMPONENTS = {
  simple: `export default function Page() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600">
      <div className="text-center text-white">
        <h1 className="text-6xl font-bold mb-4">Hello Docker!</h1>
        <p className="text-xl opacity-90">Running in an isolated container</p>
      </div>
    </div>
  );
}`,
  
  interactive: `'use client';

import { useState } from 'react';

export default function Page() {
  const [count, setCount] = useState(0);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-lg text-center">
        <h1 className="text-4xl font-bold mb-4">Counter App</h1>
        <div className="text-6xl font-bold text-blue-600 mb-6">{count}</div>
        <div className="flex gap-4 justify-center">
          <button
            onClick={() => setCount(count - 1)}
            className="px-6 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition"
          >
            Decrease
          </button>
          <button
            onClick={() => setCount(0)}
            className="px-6 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition"
          >
            Reset
          </button>
          <button
            onClick={() => setCount(count + 1)}
            className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition"
          >
            Increase
          </button>
        </div>
      </div>
    </div>
  );
}`,

  radix: `'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { X } from 'lucide-react';

export default function Page() {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-500 to-pink-600">
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <button className="px-8 py-4 bg-white text-purple-600 rounded-lg font-semibold text-lg hover:bg-gray-100 transition">
            Open Dialog
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg p-6 w-96 shadow-xl">
            <Dialog.Title className="text-2xl font-bold mb-4">
              Radix UI Dialog
            </Dialog.Title>
            <Dialog.Description className="text-gray-600 mb-6">
              This dialog is running inside a Docker container with Radix UI primitives pre-installed!
            </Dialog.Description>
            <Dialog.Close asChild>
              <button className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>
            <button
              onClick={() => setOpen(false)}
              className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition"
            >
              Close
            </button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}`,

  animation: `'use client';

import { motion } from 'framer-motion';

export default function Page() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <div className="text-center">
        <motion.h1
          className="text-6xl font-bold text-white mb-8"
          initial={{ opacity: 0, y: -50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          Framer Motion
        </motion.h1>
        <motion.div
          className="w-32 h-32 bg-gradient-to-br from-blue-400 to-purple-600 rounded-lg mx-auto"
          animate={{
            scale: [1, 1.2, 1],
            rotate: [0, 180, 360],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
        <motion.p
          className="text-white text-xl mt-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          Animations running in Docker!
        </motion.p>
      </div>
    </div>
  );
}`,
};

export default function DockerSandboxDemoPage() {
  const [selectedExample, setSelectedExample] = useState<keyof typeof EXAMPLE_COMPONENTS>('simple');
  const [customCode, setCustomCode] = useState('');
  const [activeCode, setActiveCode] = useState(EXAMPLE_COMPONENTS.simple);
  const [sessionId, setSessionId] = useState<string>();
  const [dockerStatus, setDockerStatus] = useState<any>(null);

  // Check Docker status
  const checkDockerStatus = async () => {
    try {
      const response = await fetch('/api/sandbox/status');
      const data = await response.json();
      setDockerStatus(data);
    } catch (error) {
      console.error('Failed to check Docker status:', error);
    }
  };

  // Load example
  const loadExample = (example: keyof typeof EXAMPLE_COMPONENTS) => {
    setSelectedExample(example);
    setActiveCode(EXAMPLE_COMPONENTS[example]);
  };

  // Run custom code
  const runCustomCode = () => {
    setActiveCode(customCode);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold">Docker Sandbox Demo</h1>
          <p className="text-gray-600">
            Test component previews in isolated Docker containers
          </p>
          <Button onClick={checkDockerStatus} variant="outline">
            Check Docker Status
          </Button>
        </div>

        {/* Docker Status */}
        {dockerStatus && (
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Docker Status</h3>
                <p className="text-sm text-gray-600">
                  {dockerStatus.available ? (
                    <span className="text-green-600">✅ Available</span>
                  ) : (
                    <span className="text-red-600">❌ Not Available</span>
                  )}
                  {' | '}
                  {dockerStatus.enabled ? (
                    <span className="text-green-600">Enabled</span>
                  ) : (
                    <span className="text-yellow-600">Disabled</span>
                  )}
                </p>
              </div>
              {dockerStatus.available && (
                <div className="text-sm text-gray-600">
                  <div>Version: {dockerStatus.serverVersion}</div>
                  <div>Running Containers: {dockerStatus.containersRunning}</div>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left: Examples & Code */}
          <div className="space-y-4">
            <Card className="p-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="font-semibold">Choose an Example</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant={selectedExample === 'simple' ? 'default' : 'outline'}
                      onClick={() => loadExample('simple')}
                    >
                      Simple
                    </Button>
                    <Button
                      variant={selectedExample === 'interactive' ? 'default' : 'outline'}
                      onClick={() => loadExample('interactive')}
                    >
                      Interactive
                    </Button>
                    <Button
                      variant={selectedExample === 'radix' ? 'default' : 'outline'}
                      onClick={() => loadExample('radix')}
                    >
                      Radix UI
                    </Button>
                    <Button
                      variant={selectedExample === 'animation' ? 'default' : 'outline'}
                      onClick={() => loadExample('animation')}
                    >
                      Animation
                    </Button>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Code Preview</h4>
                  <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-auto max-h-96 text-sm">
                    <code>{activeCode}</code>
                  </pre>
                </div>

                <div className="border-t pt-4">
                  <h3 className="font-semibold mb-2">Or Write Custom Code</h3>
                  <textarea
                    value={customCode}
                    onChange={(e) => setCustomCode(e.target.value)}
                    className="w-full h-48 p-4 font-mono text-sm border rounded-lg"
                    placeholder="export default function Page() {&#10;  return <div>Your component here</div>;&#10;}"
                  />
                  <Button onClick={runCustomCode} className="w-full mt-2">
                    Run Custom Code
                  </Button>
                </div>
              </div>
            </Card>

            {/* Info */}
            <Card className="p-4 bg-blue-50 border-blue-200">
              <h4 className="font-semibold text-blue-900 mb-2">ℹ️ Information</h4>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• Each preview runs in a separate Docker container</li>
                <li>• Containers have 512MB memory and 0.5 CPU limit</li>
                <li>• Idle containers are cleaned up after 30 minutes</li>
                <li>• Session ID: {sessionId || 'Not created yet'}</li>
              </ul>
            </Card>
          </div>

          {/* Right: Preview */}
          <div>
            <Card className="p-4 h-[800px] flex flex-col">
              <h3 className="font-semibold mb-4">Live Preview</h3>
              <div className="flex-1 min-h-0">
                <SandboxPreview
                  code={activeCode}
                  sessionId={sessionId}
                  onSessionIdChange={setSessionId}
                  onError={(error) => {
                    console.error('Sandbox error:', error);
                    alert(`Sandbox error: ${error}`);
                  }}
                />
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
