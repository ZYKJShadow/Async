/**
 * Shell 自动检测和管理
 * 
 * 自动检测与选择 Shell：
 * - 根据平台自动选择合适的 Shell
 * - 支持用户自定义 Shell
 * - 缓存检测结果（会话级别）
 * - 提供降级策略
 */

import { getPlatform, isWindows, isUnixLike } from '../platform';
import type { ShellProvider, ShellConfig } from './shellProvider';
import { createBashProvider, findUnixShell } from './bashProvider';
import { findPowerShell } from './powershellProvider';

/** 缓存的 Shell 配置 */
let cachedShellConfig: ShellConfig | null = null;

/**
 * 检测并获取最佳可用的 Shell Provider
 *
 * 检测逻辑（所有平台一致）：
 * 1. 优先寻找 POSIX bash（Windows 上用 Git Bash / MSYS2 / WSL，类 Unix 上用系统 bash/zsh）
 * 2. 找不到则报错——LLM 工具只支持 POSIX 语法，不再回落到 PowerShell
 *
 * PowerShell provider 仍保留给内置终端的 profile 使用，但 LLM 的 Bash 工具不再使用它。
 */
export async function detectShellProvider(): Promise<ShellConfig> {
  if (cachedShellConfig) {
    return cachedShellConfig;
  }

  const platform = getPlatform();

  try {
    if (isWindows() || isUnixLike()) {
      const bashProvider = await createBashProvider();
      if (bashProvider) {
        cachedShellConfig = {
          provider: bashProvider,
          isPreferred: true,
        };
        return cachedShellConfig;
      }

      if (isWindows()) {
        throw new Error(
          'No POSIX bash found on Windows. Install Git for Windows (https://git-scm.com/download/win) ' +
            'or set CLAUDE_CODE_SHELL to a bash/zsh executable.'
        );
      }
      throw new Error('No suitable Unix shell found (bash/zsh required).');
    }

    throw new Error(`Unsupported platform: ${platform}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to detect shell provider: ${message}`);
  }
}

/**
 * 获取当前会话的 Shell Provider（带缓存）
 */
export async function getShellProvider(): Promise<ShellProvider> {
  const config = await detectShellProvider();
  return config.provider;
}

/**
 * 重置 Shell 检测缓存
 * 主要用于测试或 Shell 环境变化时
 */
export function resetShellCache(): void {
  cachedShellConfig = null;
}

/**
 * 手动设置 Shell Provider
 * 用于高级场景或测试
 */
export function setShellProvider(provider: ShellProvider): void {
  cachedShellConfig = {
    provider,
    isPreferred: true,
  };
}

/**
 * 获取可用的 Shell 信息（用于诊断）
 */
export async function getShellDiagnostics(): Promise<{
  platform: string;
  availableShells: string[];
  selectedShell: string | null;
  environment: {
    CLAUDE_CODE_SHELL?: string;
    SHELL?: string;
    ComSpec?: string;
  };
}> {
  const platform = getPlatform();
  const availableShells: string[] = [];

  // 检测可用的 Shell（不再为 LLM 工具检测 PowerShell；仅记录系统是否安装供诊断）
  const unix = await findUnixShell();
  if (unix) availableShells.push(unix);

  if (isWindows()) {
    const ps = await findPowerShell();
    if (ps) availableShells.push(`${ps} (terminal-only, not used by Bash tool)`);
  }

  // 当前选中的 Shell
  let selectedShell: string | null = null;
  try {
    const provider = await getShellProvider();
    selectedShell = provider.shellPath;
  } catch {
    // 忽略错误
  }

  return {
    platform,
    availableShells,
    selectedShell,
    environment: {
      CLAUDE_CODE_SHELL: process.env.CLAUDE_CODE_SHELL,
      SHELL: process.env.SHELL,
      ComSpec: process.env.ComSpec,
    },
  };
}
