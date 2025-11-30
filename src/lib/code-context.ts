import fs from 'fs/promises';
import path from 'path';

export interface FileContext {
  path: string;
  content: string;
  size: number;
  language: string;
}

export interface ProjectContext {
  files: FileContext[];
  structure: string;
  dependencies: string[];
  totalFiles: number;
  truncated: boolean;
}

// File extensions to include for context
const CODE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.css', '.json'];
const IGNORE_DIRS = ['node_modules', '.next', '.git', 'dist', 'build', '.turbo'];
const IGNORE_FILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];

// Max context limits
const MAX_FILE_SIZE = 10000; // 10KB per file
const MAX_TOTAL_CONTEXT = 50000; // 50KB total context
const MAX_FILES = 20; // Maximum files to include

/**
 * Get the language identifier for a file
 */
function getLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    '.tsx': 'tsx',
    '.ts': 'typescript',
    '.jsx': 'jsx',
    '.js': 'javascript',
    '.css': 'css',
    '.json': 'json',
    '.md': 'markdown',
  };
  return langMap[ext] || 'text';
}

/**
 * Recursively get all code files in a directory
 */
async function getAllFiles(
  dir: string,
  baseDir: string,
  files: string[] = []
): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);
      
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.includes(entry.name)) {
          await getAllFiles(fullPath, baseDir, files);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (
          CODE_EXTENSIONS.includes(ext) &&
          !IGNORE_FILES.includes(entry.name)
        ) {
          files.push(relativePath);
        }
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error);
  }
  
  return files;
}

/**
 * Generate a tree structure of the project
 */
async function generateProjectTree(
  dir: string,
  prefix: string = '',
  isLast: boolean = true
): Promise<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const lines: string[] = [];
  
  // Filter and sort entries
  const filtered = entries
    .filter(e => !IGNORE_DIRS.includes(e.name) && !IGNORE_FILES.includes(e.name))
    .sort((a, b) => {
      // Directories first
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  for (let i = 0; i < filtered.length; i++) {
    const entry = filtered[i];
    const isLastEntry = i === filtered.length - 1;
    const connector = isLastEntry ? '└── ' : '├── ';
    const childPrefix = isLastEntry ? '    ' : '│   ';
    
    lines.push(`${prefix}${connector}${entry.name}`);
    
    if (entry.isDirectory()) {
      const childPath = path.join(dir, entry.name);
      const subtree = await generateProjectTree(
        childPath,
        prefix + childPrefix,
        isLastEntry
      );
      if (subtree) lines.push(subtree);
    }
  }
  
  return lines.join('\n');
}

/**
 * Extract imports from a TypeScript/JavaScript file
 */
function extractImports(content: string): string[] {
  const imports: string[] = [];
  const importRegex = /import\s+.*?from\s+['"](.+?)['"]/g;
  const requireRegex = /require\s*\(\s*['"](.+?)['"]\s*\)/g;
  
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  while ((match = requireRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  
  return imports;
}

/**
 * Find related files based on imports
 */
function findRelatedFiles(
  targetFile: string,
  allFiles: FileContext[],
  depth: number = 1
): string[] {
  const target = allFiles.find(f => f.path === targetFile);
  if (!target) return [];
  
  const imports = extractImports(target.content);
  const related: Set<string> = new Set();
  
  for (const imp of imports) {
    // Skip external packages
    if (!imp.startsWith('.') && !imp.startsWith('@/')) continue;
    
    // Normalize the import path
    let importPath = imp;
    if (imp.startsWith('@/')) {
      importPath = imp.replace('@/', '');
    } else {
      const targetDir = path.dirname(targetFile);
      importPath = path.normalize(path.join(targetDir, imp));
    }
    
    // Find matching file
    const matchingFile = allFiles.find(f => {
      const withoutExt = f.path.replace(/\.(tsx?|jsx?|js)$/, '');
      const importWithoutExt = importPath.replace(/\.(tsx?|jsx?|js)$/, '');
      return withoutExt === importWithoutExt || f.path === importPath;
    });
    
    if (matchingFile) {
      related.add(matchingFile.path);
    }
  }
  
  return Array.from(related);
}

/**
 * Get full project context for AI
 */
export async function getProjectContext(
  projectPath: string,
  options: {
    targetFile?: string;
    includeRelated?: boolean;
    maxContext?: number;
  } = {}
): Promise<ProjectContext> {
  const {
    targetFile,
    includeRelated = true,
    maxContext = MAX_TOTAL_CONTEXT,
  } = options;

  const allFilePaths = await getAllFiles(projectPath, projectPath);
  const files: FileContext[] = [];
  let totalSize = 0;
  let truncated = false;

  // Prioritize files
  const prioritized = [...allFilePaths].sort((a, b) => {
    // Target file first
    if (targetFile) {
      if (a === targetFile) return -1;
      if (b === targetFile) return 1;
    }
    
    // Then page.tsx files
    if (a.includes('page.tsx') && !b.includes('page.tsx')) return -1;
    if (!a.includes('page.tsx') && b.includes('page.tsx')) return 1;
    
    // Then layout files
    if (a.includes('layout.tsx') && !b.includes('layout.tsx')) return -1;
    if (!a.includes('layout.tsx') && b.includes('layout.tsx')) return 1;
    
    // Then components
    if (a.includes('components/') && !b.includes('components/')) return -1;
    if (!a.includes('components/') && b.includes('components/')) return 1;
    
    return a.localeCompare(b);
  });

  // Read prioritized files
  for (const filePath of prioritized) {
    if (files.length >= MAX_FILES) {
      truncated = true;
      break;
    }
    
    try {
      const fullPath = path.join(projectPath, filePath);
      const stat = await fs.stat(fullPath);
      
      if (stat.size > MAX_FILE_SIZE) continue;
      if (totalSize + stat.size > maxContext) {
        truncated = true;
        continue;
      }
      
      const content = await fs.readFile(fullPath, 'utf-8');
      files.push({
        path: filePath,
        content,
        size: stat.size,
        language: getLanguage(filePath),
      });
      totalSize += stat.size;
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
    }
  }

  // If target file specified, ensure related files are included
  if (targetFile && includeRelated) {
    const relatedPaths = findRelatedFiles(targetFile, files);
    for (const relPath of relatedPaths) {
      if (!files.find(f => f.path === relPath)) {
        // Try to add related file
        try {
          const fullPath = path.join(projectPath, relPath);
          const content = await fs.readFile(fullPath, 'utf-8');
          if (content.length + totalSize <= maxContext) {
            files.push({
              path: relPath,
              content,
              size: content.length,
              language: getLanguage(relPath),
            });
            totalSize += content.length;
          }
        } catch {}
      }
    }
  }

  // Generate project structure
  let structure = '';
  try {
    structure = await generateProjectTree(projectPath);
  } catch (error) {
    console.error('Error generating project tree:', error);
  }

  // Get dependencies from package.json
  let dependencies: string[] = [];
  try {
    const pkgPath = path.join(projectPath, 'package.json');
    const pkgContent = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent);
    dependencies = [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
    ];
  } catch {}

  return {
    files,
    structure,
    dependencies,
    totalFiles: allFilePaths.length,
    truncated,
  };
}

/**
 * Get context for a specific file with its related files
 */
export async function getFileContext(
  projectPath: string,
  filePath: string
): Promise<{
  targetFile: FileContext | null;
  relatedFiles: FileContext[];
  projectStructure: string;
}> {
  const context = await getProjectContext(projectPath, {
    targetFile: filePath,
    includeRelated: true,
    maxContext: 30000, // Lower limit for single file context
  });

  const targetFile = context.files.find(f => f.path === filePath) || null;
  const relatedFiles = context.files.filter(f => f.path !== filePath);

  return {
    targetFile,
    relatedFiles,
    projectStructure: context.structure,
  };
}

/**
 * Format project context for AI prompt
 */
export function formatContextForPrompt(context: ProjectContext): string {
  const parts: string[] = [];

  // Project structure
  if (context.structure) {
    parts.push('## 📁 PROJECT STRUCTURE');
    parts.push('```');
    parts.push(context.structure);
    parts.push('```');
    parts.push('');
  }

  // Dependencies
  if (context.dependencies.length > 0) {
    parts.push('## 📦 AVAILABLE DEPENDENCIES');
    parts.push(context.dependencies.slice(0, 30).join(', '));
    parts.push('');
  }

  // Files
  if (context.files.length > 0) {
    parts.push('## 📄 PROJECT FILES');
    parts.push(`(${context.files.length} of ${context.totalFiles} files shown${context.truncated ? ' - truncated' : ''})`);
    parts.push('');

    for (const file of context.files) {
      parts.push(`### FILE: ${file.path}`);
      parts.push(`\`\`\`${file.language}`);
      parts.push(file.content);
      parts.push('```');
      parts.push('');
    }
  }

  return parts.join('\n');
}

/**
 * Format single file context for modification
 */
export function formatFileContextForModification(
  targetFile: FileContext,
  relatedFiles: FileContext[],
  projectStructure: string
): string {
  const parts: string[] = [];

  parts.push('## 🎯 FILE TO MODIFY');
  parts.push(`### FILE: ${targetFile.path}`);
  parts.push(`\`\`\`${targetFile.language}`);
  parts.push(targetFile.content);
  parts.push('```');
  parts.push('');

  if (relatedFiles.length > 0) {
    parts.push('## 🔗 RELATED FILES (for context)');
    for (const file of relatedFiles.slice(0, 5)) {
      parts.push(`### FILE: ${file.path}`);
      parts.push(`\`\`\`${file.language}`);
      parts.push(file.content);
      parts.push('```');
      parts.push('');
    }
  }

  if (projectStructure) {
    parts.push('## 📁 PROJECT STRUCTURE');
    parts.push('```');
    parts.push(projectStructure);
    parts.push('```');
  }

  return parts.join('\n');
}
