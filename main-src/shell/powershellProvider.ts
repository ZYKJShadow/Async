/**
 * PowerShell Shell Provider
 * 
 * 提供 PowerShell 的执行逻辑
 * 适用于 Windows 系统
 * 
 * 特性：
 * - 自动处理 UTF-8 编码
 * - 禁用 Profile 加载（提高性能）
 * - 非交互式模式
 */

import { execFileSync } from 'node:child_process';
import type { ShellProvider, ShellCommandResult, ShellCommandOptions } from './shellProvider';
import { windowsPowerShellUtf8Command } from '../winUtf8';

/**
 * PowerShell expects -EncodedCommand content as UTF-16LE Base64.
 * Passing the command this way avoids extra quoting/parsing layers corrupting
 * quotes, newlines, `$?`, `!`, and pipeline-heavy commands.
 */
function encodePowerShellCommand(command: string): string {
  return Buffer.from(command, 'utf16le').toString('base64');
}

/**
 * PowerShell invocation flags shared by non-interactive command execution.
 */
function buildPowerShellArgs(command: string): string[] {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encodePowerShellCommand(command),
  ];
}

/** PowerShell Shell Provider 实现 */
export class PowerShellProvider implements ShellProvider {
  readonly type = 'powershell' as const;
  readonly shellPath: string;

  constructor(shellPath: string = 'powershell.exe') {
    this.shellPath = shellPath;
  }

  /**
   * 构建执行命令
   * 
   * PowerShell 参数说明：
   * -NoProfile: 不加载用户 Profile（提高性能）
   * -NonInteractive: 非交互式模式
   * -ExecutionPolicy Bypass: 绕过执行策略限制
   * -Command: 执行后面的命令
   * 
   * UTF-8 处理：
   * 使用 windowsPowerShellUtf8Command() 包装用户命令，确保：
   * - 输出编码为 UTF-8
   * - 输入编码为 UTF-8
   * - 管道编码为 UTF-8
   */
  buildCommand(userCommand: string, _options?: ShellCommandOptions): ShellCommandResult {
    const utf8Command = windowsPowerShellUtf8Command(userCommand);
    const command = `${utf8Command}; $_asyncExitCode = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 }; exit $_asyncExitCode`;
    
    return {
      command: this.shellPath,
      args: buildPowerShellArgs(command),
    };
  }

  /** PowerShell 默认为非交互式 */
  isInteractive(): boolean {
    return false;
  }

  /**
   * 获取交互式 Shell 参数
   * -NoExit: 执行命令后不退出
   */
  getInteractiveArgs(): string[] {
    return ['-NoLogo', '-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', windowsPowerShellUtf8Command('')];
  }
}

/** PowerShell 可执行文件路径列表 */
const POWERSHELL_PATHS = [
  'pwsh.exe',           // PowerShell 7+ (跨平台)
  'powershell.exe',     // Windows PowerShell 5.1
  'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  'C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe',
];

/**
 * 检查命令是否可用
 */
function isCommandAvailable(cmd: string): boolean {
  try {
    execFileSync(cmd, ['-Version'], {
      timeout: 2000,
      stdio: 'ignore',
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 查找可用的 PowerShell
 * 
 * 优先级：
 * 1. pwsh.exe (PowerShell 7+, 跨平台)
 * 2. powershell.exe (Windows PowerShell 5.1)
 * 3. 完整路径
 */
export async function findPowerShell(): Promise<string | null> {
  // 1. 尝试 pwsh (PowerShell 7+)
  if (isCommandAvailable('pwsh.exe')) {
    return 'pwsh.exe';
  }

  // 2. 尝试 powershell.exe (Windows 自带)
  if (isCommandAvailable('powershell.exe')) {
    return 'powershell.exe';
  }

  // 3. 尝试完整路径
  for (const psPath of POWERSHELL_PATHS) {
    if (isCommandAvailable(psPath)) {
      return psPath;
    }
  }

  return null;
}

/**
 * 创建 PowerShell Provider
 * 
 * 自动检测可用的 PowerShell 版本
 */
export async function createPowerShellProvider(): Promise<PowerShellProvider | null> {
  const psPath = await findPowerShell();
  if (!psPath) {
    return null;
  }
  return new PowerShellProvider(psPath);
}

/**
 * 创建指定路径的 PowerShell Provider
 */
export function createPowerShellProviderWithPath(shellPath: string): PowerShellProvider {
  return new PowerShellProvider(shellPath);
}
