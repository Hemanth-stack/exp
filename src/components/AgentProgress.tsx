'use client';

import { Loader2, Check, FileCode, Sparkles, Brain, FolderSearch, Save, CheckCircle2 } from 'lucide-react';

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
  emoji: string;
}> = {
  understanding: { 
    label: 'Understanding request', 
    icon: <Brain className="h-3.5 w-3.5" />, 
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/20',
    emoji: '🧠'
  },
  context: { 
    label: 'Fetching context', 
    icon: <FolderSearch className="h-3.5 w-3.5" />, 
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20',
    emoji: '📂'
  },
  reading_file: { 
    label: 'Reading files', 
    icon: <FileCode className="h-3.5 w-3.5" />, 
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/20',
    emoji: '📖'
  },
  analyzing: { 
    label: 'Analyzing code', 
    icon: <Brain className="h-3.5 w-3.5" />, 
    color: 'text-indigo-400',
    bgColor: 'bg-indigo-500/20',
    emoji: '🔍'
  },
  planning: { 
    label: 'Planning approach', 
    icon: <Brain className="h-3.5 w-3.5" />, 
    color: 'text-teal-400',
    bgColor: 'bg-teal-500/20',
    emoji: '📋'
  },
  thinking: { 
    label: 'Thinking', 
    icon: <Brain className="h-3.5 w-3.5" />, 
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/20',
    emoji: '💭'
  },
  generating: { 
    label: 'Generating code', 
    icon: <Sparkles className="h-3.5 w-3.5" />, 
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
    emoji: '✨'
  },
  parsing: { 
    label: 'Processing response', 
    icon: <FileCode className="h-3.5 w-3.5" />, 
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/20',
    emoji: '⚙️'
  },
  writing: { 
    label: 'Writing files', 
    icon: <Save className="h-3.5 w-3.5" />, 
    color: 'text-pink-400',
    bgColor: 'bg-pink-500/20',
    emoji: '💾'
  },
  file_write: { 
    label: 'Saving file', 
    icon: <FileCode className="h-3.5 w-3.5" />, 
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/20',
    emoji: '📄'
  },
  file_action: { 
    label: 'File operation', 
    icon: <FileCode className="h-3.5 w-3.5" />, 
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/20',
    emoji: '📁'
  },
  committing: { 
    label: 'Committing changes', 
    icon: <Save className="h-3.5 w-3.5" />, 
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/20',
    emoji: '📝'
  },
  pushing: { 
    label: 'Pushing to GitHub', 
    icon: <Sparkles className="h-3.5 w-3.5" />, 
    color: 'text-violet-400',
    bgColor: 'bg-violet-500/20',
    emoji: '🚀'
  },
  terminal: { 
    label: 'Running command', 
    icon: <FileCode className="h-3.5 w-3.5" />, 
    color: 'text-lime-400',
    bgColor: 'bg-lime-500/20',
    emoji: '💻'
  },
  complete: { 
    label: 'Complete', 
    icon: <CheckCircle2 className="h-3.5 w-3.5" />, 
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
    emoji: '✅'
  },
};

export function AgentProgress({ 
  steps, 
  isStreaming, 
}: AgentProgressProps) {
  // Simply get the current active step (the last 'start' status step)
  const activeStep = [...steps].reverse().find(s => s.status === 'start');
  
  // Get the completion step if present
  const completeStep = steps.find(s => s.step === 'complete' && s.status === 'complete');
  
  // Get recent file operations (last 3)
  const recentFileOps = steps
    .filter(s => (s.step === 'file_write' || s.step === 'file_action') && s.status === 'complete')
    .slice(-3);

  // Don't render if nothing to show
  if (!isStreaming && !activeStep && !completeStep) return null;

  // Determine what to display
  const currentStep = activeStep || completeStep;
  
  if (!currentStep && !isStreaming) return null;

  const config = currentStep 
    ? (stepConfig[currentStep.step] || stepConfig[currentStep.step.split('_')[0]] || {
        label: currentStep.step,
        color: 'text-gray-400',
        bgColor: 'bg-gray-500/20',
        emoji: '•'
      })
    : null;

  return (
    <div className="flex items-center gap-2 py-2 px-3 bg-muted/30 rounded-lg border border-border/50">
      {/* Current step indicator */}
      {currentStep && (
        <div
          className={`
            inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
            transition-all duration-200
            ${currentStep.status === 'start' ? `${config?.bgColor} ${config?.color}` : ''}
            ${currentStep.status === 'complete' ? 'bg-green-500/20 text-green-400' : ''}
          `}
        >
          {currentStep.status === 'start' && <Loader2 className="h-3 w-3 animate-spin" />}
          {currentStep.status === 'complete' && <Check className="h-3 w-3" />}
          <span>
            {currentStep.icon || config?.emoji} {currentStep.message || config?.label}
          </span>
        </div>
      )}
      
      {/* Show waiting indicator if streaming but no current step */}
      {isStreaming && !currentStep && (
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Processing...</span>
        </div>
      )}

      {/* Show file count if any files were created */}
      {recentFileOps.length > 0 && !isStreaming && (
        <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-emerald-500/20 text-emerald-400">
          <FileCode className="h-3 w-3" />
          <span>{recentFileOps.length} file(s)</span>
        </div>
      )}
    </div>
  );
}

// Compact single-line version for tight spaces
export function AgentProgressCompact({ steps, isStreaming }: { steps: AgentStep[]; isStreaming: boolean }) {
  const activeStep = [...steps].reverse().find(s => s.status === 'start');
  const completedCount = steps.filter(s => s.status === 'complete').length;
  
  if (steps.length === 0 && !isStreaming) return null;

  const config = activeStep ? (stepConfig[activeStep.step] || stepConfig[activeStep.step.split('_')[0]]) : null;

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {isStreaming ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
          <span className={config?.color || 'text-blue-300'}>
            {activeStep?.message || 'Processing...'}
          </span>
          <span className="opacity-50">•</span>
          <span>{completedCount} steps done</span>
        </>
      ) : (
        <>
          <Check className="h-3 w-3 text-green-400" />
          <span className="text-green-400">Done</span>
          <span className="opacity-50">•</span>
          <span>{completedCount} steps completed</span>
        </>
      )}
    </div>
  );
}

// Inline version for showing in chat messages
export function AgentProgressInline({ steps }: { steps: AgentStep[] }) {
  const completedSteps = steps.filter(s => s.status === 'complete');
  
  if (completedSteps.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {completedSteps.slice(0, 6).map((step, index) => {
        const config = stepConfig[step.step] || { color: 'text-gray-400', emoji: '✓' };
        return (
          <span
            key={index}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/60 text-xs text-muted-foreground"
          >
            <span>{step.icon || config.emoji}</span>
            <span>{step.step.replace('_', ' ')}</span>
          </span>
        );
      })}
      {completedSteps.length > 6 && (
        <span className="text-xs text-muted-foreground self-center">
          +{completedSteps.length - 6} more
        </span>
      )}
    </div>
  );
}
