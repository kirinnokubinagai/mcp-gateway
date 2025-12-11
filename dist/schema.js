import { z } from 'zod';
export const serverSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(z.string()).default({}),
    autoStart: z.boolean().default(true)
});
export const profileSchema = z.object({
    name: z.string().min(1),
    servers: z.array(z.string()).default([])
});
