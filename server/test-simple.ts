import { configValidator } from './simple-validator.ts';
import fs from 'fs/promises';

async function test() {
  console.log('Testing simple validator...');
  
  try {
    const data = await fs.readFile('/app/mcp-config.json', 'utf-8');
    const config = JSON.parse(data);
    console.log('Config loaded:', typeof config, Object.keys(config));
    
    const result = await configValidator.validateConfig(config);
    console.log('Validation result:', result);
  } catch (error) {
    console.error('Error:', error);
  }
}

test();