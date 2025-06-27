import { exec } from 'child_process';
import { promisify } from 'util';
import { access } from 'fs/promises';
import { constants } from 'fs';
import { ERROR_MESSAGES, TIMEOUT_CONFIG } from './constants.js';

const execAsync = promisify(exec);

export interface ValidationResult {
  valid: boolean;
  errorType?: 'command_not_found' | 'package_not_found' | 'permission_denied' | 'unknown';
  errorMessage?: string;
}

export async function validateCommand(command: string, args: string[] = []): Promise<ValidationResult> {
  if (command === 'npx') {
    return validateNpxCommand(args);
  } else if (command === 'node' || command === 'bun' || command === 'deno') {
    return validateScriptCommand(command, args);
  } else {
    return validateSystemCommand(command);
  }
}

async function validateNpxCommand(args: string[]): Promise<ValidationResult> {
  let packageName = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-y' || args[i] === '--yes') {
      continue;
    }
    if (!args[i].startsWith('-')) {
      packageName = args[i];
      break;
    }
  }
  
  if (!packageName) {
    return {
      valid: false,
      errorType: 'unknown',
      errorMessage: ERROR_MESSAGES.NO_PACKAGE_NAME
    };
  }
  
  try {
    const { stdout, stderr } = await execAsync(`npm view ${packageName} name --json`, {
      timeout: TIMEOUT_CONFIG.VALIDATION
    });
    
    if (stderr.includes('404') || stderr.includes('Not Found')) {
      return {
        valid: false,
        errorType: 'package_not_found',
        errorMessage: `${ERROR_MESSAGES.PACKAGE_NOT_FOUND}: ${packageName}`
      };
    }
    
    return { valid: true };
  } catch (error: any) {
    if (error.message.includes('404') || error.stderr?.includes('404')) {
      return {
        valid: false,
        errorType: 'package_not_found',
        errorMessage: `${ERROR_MESSAGES.PACKAGE_NOT_FOUND}: ${packageName}`
      };
    }
    
    return { valid: true };
  }
}

async function validateScriptCommand(command: string, args: string[]): Promise<ValidationResult> {
  if (args.length > 0 && !args[0].startsWith('-')) {
    try {
      await access(args[0], constants.F_OK);
      return { valid: true };
    } catch {
      return {
        valid: false,
        errorType: 'command_not_found',
        errorMessage: `${ERROR_MESSAGES.SCRIPT_NOT_FOUND}: ${args[0]}`
      };
    }
  }
  
  return { valid: true };
}

async function validateSystemCommand(command: string): Promise<ValidationResult> {
  try {
    const { stdout, stderr } = await execAsync(`which ${command}`, {
      timeout: TIMEOUT_CONFIG.COMMAND_CHECK
    });
    
    if (stderr || !stdout.trim()) {
      return {
        valid: false,
        errorType: 'command_not_found',
        errorMessage: `${ERROR_MESSAGES.COMMAND_NOT_FOUND}: ${command}`
      };
    }
    
    return { valid: true };
  } catch {
    return {
      valid: false,
      errorType: 'command_not_found',
      errorMessage: `${ERROR_MESSAGES.COMMAND_NOT_FOUND}: ${command}`
    };
  }
}