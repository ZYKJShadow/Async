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
import { createPowerShellProvider, findPowerShell } from './powershellProvider';

/** 缓存的 Shell 配置 */
let cachedShellConfig: ShellConfig | null = null;

/**
 * 检测并获取最佳可用的 Shell Provider
 * 
 * 检测逻辑：
 * 1. 检查环境变量 CLAUDE_CODE_SHELL（用户自定义）
 * 2. Windows: PowerShell (pwsh > powershell)
 * 3. macOS/Linux/WSL: Bash/Zsh (遵循 SHELL 环境变量)
 * 4. 降级策略
 */
export async function detectShellProvider(): Promise<ShellConfig> {
  // 返回缓存
  if (cachedShellConfig) {
    return cachedShellConfig;
  }

  const platform = getPlatform();

  try {
    // Windows 平台
    if (isWindows()) {
      const psProvider = await createPowerShellProvider();
      if (psProvider) {
        cachedShellConfig = {
          provider: psProvider,
          isPreferred: true,
        };
        return cachedShellConfig;
      }
      
      // PowerShell 不可用时的降级
      throw new Error('PowerShell not found on Windows system');
    }

    // 类 Unix 系统 (macOS, Linux, WSL)
    if (isUnixLike()) {
      const bashProvider = await createBashProvider();
      if (bashProvider) {
        cachedShellConfig = {
          provider: bashProvider,
          isPreferred: true,
        };
        return cachedShellConfig;
      }
      
      // Bash/Zsh 不可用时的降级
      throw new Error('No suitable Unix shell found (bash/zsh required)');
    }

    // 未知平台
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
  
  // 检测可用的 Shell
  if (isWindows()) {
    const ps = await findPowerShell();
    if (ps) availableShells.push(ps);
  }
  
  if (isUnixLike()) {
    const unix = await findUnixShell();
    if (unix) availableShells.push(unix);
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
