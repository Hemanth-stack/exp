'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { 
  generateComponent, 
  debugCode, 
  analyzeCode, 
  improveCode,
  type AgentType 
} from '@/lib/mastra-client';

export default function MastraAgentDemo() {
  const [prompt, setPrompt] = useState('');
  const [code, setCode] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentType>('generate');

  const handleSubmit = async (agentType: AgentType) => {
    setLoading(true);
    setResponse('');
    
    try {
      let result;
      
      switch (agentType) {
        case 'generate':
          result = await generateComponent({ prompt });
          break;
        case 'debug':
          result = await debugCode({ code, error: 'Please debug this code' });
          break;
        case 'analyze':
          result = await analyzeCode({ code });
          break;
        case 'improve':
          result = await improveCode({ code });
          break;
      }
      
      setResponse(result.result);
    } catch (error: any) {
      setResponse(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold text-white">
            Mastra AI Agents Demo
          </h1>
          <p className="text-gray-400">
            Test all four specialized agents powered by Claude Sonnet 4
          </p>
        </div>

        {/* Agent Selection */}
        <Card className="p-6 bg-gray-800 border-gray-700">
          <h2 className="text-xl font-semibold text-white mb-4">
            Select Agent
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Button
              onClick={() => setActiveAgent('generate')}
              variant={activeAgent === 'generate' ? 'default' : 'outline'}
              className="h-auto py-4 flex flex-col items-start gap-2"
            >
              <span className="text-2xl">🎨</span>
              <div className="text-left">
                <div className="font-semibold">Generator</div>
                <div className="text-xs opacity-70">Create components</div>
              </div>
            </Button>
            
            <Button
              onClick={() => setActiveAgent('debug')}
              variant={activeAgent === 'debug' ? 'default' : 'outline'}
              className="h-auto py-4 flex flex-col items-start gap-2"
            >
              <span className="text-2xl">🐛</span>
              <div className="text-left">
                <div className="font-semibold">Debugger</div>
                <div className="text-xs opacity-70">Fix code issues</div>
              </div>
            </Button>
            
            <Button
              onClick={() => setActiveAgent('analyze')}
              variant={activeAgent === 'analyze' ? 'default' : 'outline'}
              className="h-auto py-4 flex flex-col items-start gap-2"
            >
              <span className="text-2xl">🔍</span>
              <div className="text-left">
                <div className="font-semibold">Analyzer</div>
                <div className="text-xs opacity-70">Analyze quality</div>
              </div>
            </Button>
            
            <Button
              onClick={() => setActiveAgent('improve')}
              variant={activeAgent === 'improve' ? 'default' : 'outline'}
              className="h-auto py-4 flex flex-col items-start gap-2"
            >
              <span className="text-2xl">⚡</span>
              <div className="text-left">
                <div className="font-semibold">Improver</div>
                <div className="text-xs opacity-70">Enhance code</div>
              </div>
            </Button>
          </div>
        </Card>

        {/* Input Section */}
        <Card className="p-6 bg-gray-800 border-gray-700">
          <h2 className="text-xl font-semibold text-white mb-4">
            Input
          </h2>
          
          {activeAgent === 'generate' ? (
            <div className="space-y-2">
              <label className="text-sm text-gray-400">
                Describe what you want to generate:
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="E.g., Create a responsive pricing table with 3 tiers..."
                className="w-full h-32 p-4 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-sm text-gray-400">
                Paste your code:
              </label>
              <textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Paste your React/TypeScript code here..."
                className="w-full h-32 p-4 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 font-mono text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
          )}
          
          <Button
            onClick={() => handleSubmit(activeAgent)}
            disabled={loading || (activeAgent === 'generate' ? !prompt : !code)}
            className="mt-4 w-full"
          >
            {loading ? 'Processing...' : `Run ${activeAgent} Agent`}
          </Button>
        </Card>

        {/* Response Section */}
        {response && (
          <Card className="p-6 bg-gray-800 border-gray-700">
            <h2 className="text-xl font-semibold text-white mb-4">
              Response
            </h2>
            <pre className="w-full p-4 bg-gray-900 border border-gray-700 rounded-lg text-green-400 font-mono text-sm overflow-x-auto whitespace-pre-wrap">
              {response}
            </pre>
          </Card>
        )}

        {/* Example Prompts */}
        <Card className="p-6 bg-gray-800 border-gray-700">
          <h2 className="text-xl font-semibold text-white mb-4">
            Example Prompts
          </h2>
          <div className="space-y-3">
            <div className="text-sm">
              <div className="font-semibold text-blue-400">Generator:</div>
              <div className="text-gray-400 italic">
                "Create a user profile card with avatar, name, bio, and social media links using Tailwind CSS"
              </div>
            </div>
            <div className="text-sm">
              <div className="font-semibold text-red-400">Debugger:</div>
              <div className="text-gray-400 italic font-mono text-xs">
                const [count setCount] = useState(0); // Missing comma
              </div>
            </div>
            <div className="text-sm">
              <div className="font-semibold text-yellow-400">Analyzer:</div>
              <div className="text-gray-400 italic">
                Paste any React component to get detailed analysis of structure, patterns, and quality
              </div>
            </div>
            <div className="text-sm">
              <div className="font-semibold text-purple-400">Improver:</div>
              <div className="text-gray-400 italic">
                Paste any component to get an optimized version with performance improvements
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
