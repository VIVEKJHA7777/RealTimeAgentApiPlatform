import { z } from 'zod';

// Clean first (trim + lower-case), THEN check the format. See phase-01 doc, task 1.2 notes.
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

// Only length rules (decision P1-6). Max 128 stops someone sending a 10 MB "password"
// to make argon2 work hard. Not trimmed: spaces in passwords are allowed.
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(100).optional(),
});

export type SignupInput = z.infer<typeof signupSchema>;

// Login doesn't re-check the 8-character rule (that's a sign-up rule; if it ever changes,
// old accounts must still be able to log in). Max 128 still protects argon2 from huge input.
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;
