import { z } from "zod";

export const JobSubmitSchema = z.object({
  company_name: z
    .string()
    .min(1, "Company name is required")
    .max(200, "Company name is too long"),
  job_title: z
    .string()
    .min(1, "Job title is required")
    .max(200, "Job title is too long"),
  job_url: z
    .string()
    .min(1, "Job URL is required")
    .url("Please enter a valid URL (include https://)"),
  location: z
    .string()
    .min(1, "Location is required")
    .max(200, "Location is too long"),
  recruiter_hint: z
    .string()
    .max(200)
    .optional()
    .transform((v) => v?.trim() || undefined),
});

export type JobSubmitInput = z.infer<typeof JobSubmitSchema>;

export const LoginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export type LoginInput = z.infer<typeof LoginSchema>;

export const SignupSchema = z
  .object({
    full_name: z.string().min(2, "Name must be at least 2 characters").max(100),
    email: z.string().email("Please enter a valid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
        "Password must contain at least one uppercase, lowercase, and number"
      ),
    confirm_password: z.string(),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  });

export type SignupInput = z.infer<typeof SignupSchema>;
