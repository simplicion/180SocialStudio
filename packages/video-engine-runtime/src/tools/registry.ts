import { VideoDirectorTool } from "./base-tool";

export class DirectorToolRegistry {
  private static instance: DirectorToolRegistry;
  private tools: Map<string, VideoDirectorTool> = new Map();

  private constructor() {}

  static getInstance(): DirectorToolRegistry {
    if (!DirectorToolRegistry.instance) {
      DirectorToolRegistry.instance = new DirectorToolRegistry();
    }
    return DirectorToolRegistry.instance;
  }

  register(tool: VideoDirectorTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): VideoDirectorTool | undefined {
    return this.tools.get(name);
  }

  getRequired(name: string): VideoDirectorTool {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`DirectorToolRegistry: Tool '${name}' not found. Available tools: ${Array.from(this.tools.keys()).join(", ")}`);
    }
    return tool;
  }

  listTools(): Array<{ name: string; description: string; stage: string }> {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      stage: t.stage,
    }));
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}
