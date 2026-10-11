import { EditIR, OtioAdapter, OtioTimeline } from "@workspace/video-contracts";

export class OtioService {
  /**
   * Converts EditIR to OTIO JSON and triggers a browser/native download.
   */
  static exportToOtioFile(editIR: EditIR, filename: string = "timeline.otio"): void {
    const otio = OtioAdapter.toOtio(editIR);
    const blob = new Blob([JSON.stringify(otio, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".otio") ? filename : `${filename}.otio`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Parses an OTIO JSON file string into an EditIR AST.
   */
  static parseOtioFile(otioJsonString: string): EditIR {
    const otio: OtioTimeline = JSON.parse(otioJsonString);
    return OtioAdapter.fromOtio(otio);
  }
}
