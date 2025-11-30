'use client';

import { Loader2, Check, AlertCircle, ChevronDown, ChevronUp, Brain, FolderSearch, Sparkles, FileCode, Save, CheckCircle2 } from 'lucide-react';

export interface AgentStep {
  type: 'step';
  step: string;
  status: 'start' | 'complete' | 'error';
  message: string;
  details?: string;
  icon?: string;
  timestamp?: Date;
}

interface AgentProgressProps {
  steps: AgentStep[];
  isStreaming: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

// Step display configuration with icons and colors
const stepConfig: Record<string, { 
  label: string; 
  icon: React.ReactNode; 
  color: string;
  bgColor: string;
}> = {
  understanding: { 
    label: 'Understanding', 
    icon: <Brain className="h-4 w-4" />, 
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10'
  },
  context: { 
    label: 'Fetching Context', 
    icon: <FolderSearch className="h-4 w-4" />, 
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10'
  },
  reading_file: { 
    label: 'Reading File', 
    icon: <FileCode className="h-4 w-4" />, 
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10'
  },
  analyzing: { 
    label: 'Analyzing', 
    icon: <Brain className="h-4 w-4" />, 
    color: 'text-indigo-400',
    bgColor: 'bg-indigo-500/10'
  },
  thinking: { 
    label: 'Thinking', 
    icon: <Brain className="h-4 w-4" />, 
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10'
  },
  generating: { 
    label: 'Generating Code', 
    icon: <Sparkles className="h-4 w-4" />, 
    color: 'text-green-400',
    bgColor: 'bg-green-500/10'
  },
  parsing: { 
    label: 'Processing', 
    icon: <FileCode className="h-4 w-4" />, 
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10'
  },
  writing: { 
    label: 'Writing Files', 
    icon: <Save className="h-4 w-4" />, 
    color: 'text-pink-400',
    bgColor: 'bg-pink-500/10'
  },
  file_write: { 
    label: 'File', 
    icon: <FileCode className="h-4 w-4" />, 
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10'
  },
  complete: { 
    label: 'Complete', 
    icon: <CheckCircle2 className="h-4 w-4" />, 
    color: 'text-green-400',
    bgColor: 'bg-green-500/10'
  },
};

const stepOrder = [
  'understanding',
  'context',
  'reading_file',
  'analyzing',
  'thinking',
  'generating',
  'parsing',
  'writing',
  'file_write',
  'complete',
];

export function AgentProgress({ 
  steps, 
  isStreaming, 
  collapsed = false,
  onToggleCollapse 
}: AgentProgressProps) {
  // Group steps by their step name and keep the latest status
  const groupedSteps = steps.reduce((acc, step) => {
    // For file_write, we want to keep all of them
    if (step.step === 'file_write') {
      const key = `${step.step}_${step.message}`;
      acc[key] = step;
    } else {
      acc[step.step] = step;
    }
    return acc;
  }, {} as Record<string, AgentStep>);

  const sortedSteps = Object.values(groupedSteps).sort((a, b) => {
    const aIndex = stepOrder.indexOf(a.step.split('_')[0]);
    const bIndex = stepOrder.indexOf(b.step.split('_')[0]);
    return aIndex - bIndex;
  });

  // Find the current active step (the latest 'start' status)
  const activeStep = [...steps].reverse().find(s => s.status === 'start');

  if (steps.length === 0 && !isStreaming) return null;

  return (
    <div className="bg-gradient-to-r from-gray-900/95 to-gray-800/95 rounded-xl border border-gray-700/50 overflow-hidden shadow-lg backdrop-blur-sm">
      {/* Header */}
      <button
        onClick={onToggleCollapse}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {isStreaming ? (
            <div className="relative">
              <div className="h-6 w-6 rounded-full bg-blue-500/20 flex items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
              </div>
              <div className="absolute inset-0 animate-ping">
                <div className="h-6 w-6 rounded-full bg-blue-400/20" />
              </div>
            </div>
          ) : (
            <div className="h-6 w-6 rounded-full bg-green-500/20 flex items-center justify-center">
              <Check className="h-4 w-4 text-green-400" />
            </div>
          )}
          <div className="text-left">
            <span className="text-sm font-medium text-gray-200">
              {isStreaming ? (activeStep?.message || 'Processing...') : '✨ All tasks completed'}
            </span>
            {isStreaming && (
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-xs text-gray-500">{sortedSteps.filter(s => s.status === 'complete').length} / {sortedSteps.length + (isStreaming ? 1 : 0)} steps</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isStreaming && sortedSteps.filter(s => s.step === 'file_write').length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">
              {sortedSteps.filter(s => s.step === 'file_write').length} file(s)
            </span>
          )}
          {collapsed ? (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronUp className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </button>

      {/* Steps List */}
      {!collapsed && (
        <div className="px-4 pb-4 space-y-1.5">
          {sortedSteps.map((step, index) => (
            <StepItem 
              key={`${step.step}-${index}`} 
              step={step}
              isActive={activeStep?.step === step.step && step.status === 'start'}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StepItem({ step, isActive }: { step: AgentStep; isActive: boolean }) {
  const config = stepConfig[step.step] || stepConfig[step.step.split('_')[0]] || {
    label: step.step,
    icon: <Sparkles className="h-4 w-4" />,
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/10'
  };

  return (
    <div
      className={`flex items-start gap-3 p-2.5 rounded-lg transition-all duration-300 ${
        isActive 
          ? `${config.bgColor} border border-${config.color.replace('text-', '')}/30` 
          : 'bg-gray-800/30 hover:bg-gray-800/50'
      }`}
    >
      {/* Status Icon */}
      <div className={`mt-0.5 flex-shrink-0 h-5 w-5 rounded-full flex items-center justify-center ${
        step.status === 'start' 
          ? config.bgColor 
          : step.status === 'complete' 
            ? 'bg-green-500/20' 
            : 'bg-red-500/20'
      }`}>
        {step.status === 'start' ? (
          <Loader2 className={`h-3 w-3 animate-spin ${config.color}`} />
        ) : step.status === 'complete' ? (
          <Check className="h-3 w-3 text-green-400" />
        ) : (
          <AlertCircle className="h-3 w-3 text-red-400" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`${config.color}`}>{config.icon}</span>
          <p className={`text-sm font-medium ${
            step.status === 'start' 
              ? config.color 
              : step.status === 'error' 
                ? 'text-red-300' 
                : 'text-gray-300'
          }`}>
            {step.message}
          </p>
        </div>
        {step.details && (
          <p className="text-xs text-gray-500 mt-1 ml-6 truncate">
            {step.details}
          </p>
        )}
      </div>

      {/* Step Emoji */}
      {step.status === 'complete' && step.icon && (
        <span className="text-base flex-shrink-0">{step.icon}</span>
      )}
    </div>
  );
}

// Compact inline version for showing in chat messages
export function AgentProgressInline({ steps }: { steps: AgentStep[] }) {
  const completedSteps = steps.filter(s => s.status === 'complete');
  
  if (completedSteps.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {completedSteps.slice(0, 5).map((step, index) => {
        const config = stepConfig[step.step] || { color: 'text-gray-400' };
        return (
          <span
            key={index}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800/80 text-xs ${config.color}`}
          >
            <span>{step.icon || '✅'}</span>
            <span className="text-gray-300">{step.step.replace('_', ' ')}</span>
          </span>
        );
      })}
      {completedSteps.length > 5 && (
        <span className="text-xs text-gray-500 self-center">
          +{completedSteps.length - 5} more
        </span>
      )}
    </div>
  );
}
