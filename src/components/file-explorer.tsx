'use client';

import React, { useState } from 'react';
import { 
  ChevronRight, 
  ChevronDown, 
  File, 
  Folder, 
  FolderOpen,
  MoreVertical,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  Circle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  modified?: boolean;
}

interface FileExplorerProps {
  files: FileNode[];
  selectedFile: string | null;
  onFileSelect: (path: string) => void;
  onFileCreate?: (parentPath: string, type: 'file' | 'directory') => void;
  onFileRename?: (path: string) => void;
  onFileDelete?: (path: string) => void;
}

export function FileExplorer({
  files,
  selectedFile,
  onFileSelect,
  onFileCreate,
  onFileRename,
  onFileDelete,
}: FileExplorerProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['/']));

  const toggleExpand = (path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const renderNode = (node: FileNode, depth: number = 0) => {
    const isExpanded = expanded.has(node.path);
    const isSelected = selectedFile === node.path;

    if (node.type === 'directory') {
      return (
        <div key={node.path}>
          <div
            className={`flex items-center gap-1 px-2 py-1 hover:bg-accent cursor-pointer group ${
              isSelected ? 'bg-accent' : ''
            }`}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
          >
            <button
              onClick={() => toggleExpand(node.path)}
              className="p-0 hover:bg-transparent"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
            {isExpanded ? (
              <FolderOpen className="h-4 w-4 text-blue-500" />
            ) : (
              <Folder className="h-4 w-4 text-blue-500" />
            )}
            <span className="flex-1 text-sm">{node.name}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                >
                  <MoreVertical className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onFileCreate?.(node.path, 'file')}>
                  <FilePlus className="h-4 w-4 mr-2" />
                  New File
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onFileCreate?.(node.path, 'directory')}>
                  <FolderPlus className="h-4 w-4 mr-2" />
                  New Folder
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onFileRename?.(node.path)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => onFileDelete?.(node.path)}
                  className="text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {isExpanded && node.children && (
            <div>
              {node.children.map(child => renderNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        key={node.path}
        className={`flex items-center gap-2 px-2 py-1 hover:bg-accent cursor-pointer group ${
          isSelected ? 'bg-accent' : ''
        }`}
        style={{ paddingLeft: `${depth * 12 + 28}px` }}
        onClick={() => onFileSelect(node.path)}
      >
        <File className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 text-sm">{node.name}</span>
        {node.modified && (
          <Circle className="h-2 w-2 fill-blue-500 text-blue-500" />
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onFileRename?.(node.path)}>
              <Pencil className="h-4 w-4 mr-2" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => onFileDelete?.(node.path)}
              className="text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  return (
    <div className="h-full overflow-auto">
      <div className="p-2 border-b bg-muted/50 font-semibold text-sm">
        Files
      </div>
      <div className="py-2">
        {files.map(node => renderNode(node, 0))}
      </div>
    </div>
  );
}
