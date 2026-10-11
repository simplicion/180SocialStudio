import { DetectedObject } from "./types";

export interface IObjectDetectionAdapter {
  detectObjects(mediaPath: string, durationSeconds: number): Promise<DetectedObject[]>;
}

export class ObjectDetector implements IObjectDetectionAdapter {
  private static customAdapter?: IObjectDetectionAdapter;

  static registerAdapter(adapter: IObjectDetectionAdapter) {
    this.customAdapter = adapter;
  }

  /**
   * Detects creative editing objects (phone, laptop, product, screen, document, etc.)
   * Uses registered local CV adapter or degrades gracefully.
   */
  async detectObjects(mediaPath: string, durationSeconds: number): Promise<DetectedObject[]> {
    if (ObjectDetector.customAdapter) {
      try {
        return await ObjectDetector.customAdapter.detectObjects(mediaPath, durationSeconds);
      } catch (err: any) {
        console.warn("[ObjectDetector] Custom adapter error, falling back:", err?.message);
      }
    }

    // Default graceful adapter: returns empty list if no local model is loaded
    return [];
  }
}
