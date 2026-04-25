/**
 * Bash Shell Provider
 * 
 * 提供 Bash/Zsh Shell 的执行逻辑
 * 适用于 macOS, Linux, WSL 等类 Unix 系统
 */

import { accessSync, constants } from 'node:fs';
import type { ShellProvider, ShellCommandResult, ShellCommandOptions } from './shellProvider';

/** Bash Shell Provider 实现 */
export class BashShellProvider implements ShellProvider {
  readonly type = 'bash' as const;
  readonly shellPath: string;

  constructor(shellPath: string) {
    this.shellPath = shellPath;
  }

  /**
   * 构建执行命令
   * 
   * Bash 使用 `-lc` 参数：
   * -l: 作为 login shell 启动，加载 profile
   * -c: 执行后面的命令字符串
   */
  buildCommand(userCommand: string, _options?: ShellCommandOptions): ShellCommandResult {
    return {
      command: this.shellPath,
      args: ['-lc', userCommand],
    };
  }

  /** Bash 默认为非交互式 */
  isInteractive(): boolean {
    return false;
  }

  /**
   * 获取交互式 Shell 参数
   * -i: interactive mode
   */
  getInteractiveArgs(): string[] {
    return ['-i'];
  }
}

/**
 * 检查路径是否为可执行文件
 */
function isExecutable(shellPath: string): boolean {
  try {
    accessSync(shellPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 常见的 Bash/Zsh 路径列表（按优先级排序）
 */
const COMMON_UNIX_SHELLS = [
  '/bin/bash',
  '/usr/bin/bash',
  '/usr/local/bin/bash',
  '/opt/homebrew/bin/bash',
  '/bin/zsh',
  '/usr/bin/zsh',
  '/usr/local/bin/zsh',
  '/opt/homebrew/bin/zsh',
];

/**
 * Windows 上常见的 POSIX bash 安装位置（Git for Windows / MSYS2 / WSL）。
 * 顺序：Git Bash 优先（最常见），然后 MSYS2 / Cygwin，最后 WSL。
 */
function getWindowsBashCandidates(): string[] {
  const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA ?? '';
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';

  const candidates = [
    `${programFiles}\\Git\\bin\\bash.exe`,
    `${programFiles}\\Git\\usr\\bin\\bash.exe`,
    `${programFilesX86}\\Git\\bin\\bash.exe`,
    `${programFilesX86}\\Git\\usr\\bin\\bash.exe`,
    'C:\\msys64\\usr\\bin\\bash.exe',
    'C:\\cygwin64\\bin\\bash.exe',
    `${systemRoot}\\System32\\bash.exe`, // WSL launcher
  ];
  if (localAppData) {
    candidates.unshift(`${localAppData}\\Programs\\Git\\bin\\bash.exe`);
  }
  return candidates;
}

/**
 * 查找可用的 Unix Shell
 *
 * 优先级：
 * 1. CLAUDE_CODE_SHELL 环境变量（用户自定义）
 * 2. SHELL 环境变量（如果是 bash 或 zsh）
 * 3. 平台默认搜索路径（POSIX 系统下的常见 bash/zsh，Windows 下的 Git Bash / MSYS2 / WSL）
 */
export async function findUnixShell(): Promise<string | null> {
  // 1. 检查自定义 Shell 覆盖
  const shellOverride = process.env.CLAUDE_CODE_SHELL;
  if (shellOverride && isExecutable(shellOverride)) {
    return shellOverride;
  }

  // 2. 检查 SHELL 环境变量
  const envShell = process.env.SHELL;
  if (envShell && isExecutable(envShell)) {
    // 只支持 bash 和 zsh
    if (envShell.includes('bash') || envShell.includes('zsh')) {
      return envShell;
    }
  }

  // 3. 搜索平台默认路径
  const searchPaths = process.platform === 'win32' ? getWindowsBashCandidates() : COMMON_UNIX_SHELLS;
  for (const shellPath of searchPaths) {
    if (isExecutable(shellPath)) {
      return shellPath;
    }
  }

  return null;
}

/**
 * 创建 Bash Shell Provider
 * 
 * 自动检测可用的 Shell
 */
export async function createBashProvider(): Promise<BashShellProvider | null> {
  const shellPath = await findUnixShell();
  if (!shellPath) {
    return null;
  }
  return new BashShellProvider(shellPath);
}

/**
 * 创建指定路径的 Bash Provider
 */
export function createBashProviderWithPath(shellPath: string): BashShellProvider {
  return new BashShellProvider(shellPath);
}
