import fs from 'fs';
import path from 'path';
import os from 'os';
import { Project } from '@/types/project';

function resolveDataDir() {
  const configured = process.env.DATA_DIR;
  if (configured) {
    // /var/task biasanya read-only di serverless (Vercel/AWS Lambda)
    if (configured.startsWith('/var/task')) {
      return path.join(os.tmpdir(), 'data');
    }
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  }

  // Default: serverless pakai /tmp, local pakai ./data
  const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
  return isServerless ? path.join(os.tmpdir(), 'data') : path.join(process.cwd(), 'data');
}

const DATA_DIR = resolveDataDir();
const DB_FILE = path.join(DATA_DIR, 'projects.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function getDataDir(): string {
  ensureDir();
  return DATA_DIR;
}

function readAll(): Record<string, Project> {
  ensureDir();
  if (!fs.existsSync(DB_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeAll(projects: Record<string, Project>) {
  ensureDir();
  fs.writeFileSync(DB_FILE, JSON.stringify(projects, null, 2));
}

export function saveProject(project: Project): void {
  const all = readAll();
  all[project.id] = project;
  writeAll(all);
}

export function getProject(id: string): Project | null {
  const all = readAll();
  return all[id] || null;
}

export function listProjects(): Project[] {
  const all = readAll();
  return Object.values(all).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function updateProject(id: string, updates: Partial<Project>): Project {
  const all = readAll();
  if (!all[id]) throw new Error(`Project ${id} not found`);
  all[id] = { ...all[id], ...updates, updatedAt: new Date().toISOString() };
  writeAll(all);
  return all[id];
}
