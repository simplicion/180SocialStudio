import ffmpeg from "./ffmpeg-setup";
import * as path from "path";
import * as fs from "fs";

const masterVideo = "c:/Users/saavi/Desktop/180workspace/drive-download-20260917T164609Z-1-001/master_client_acquisition_ad.mp4";
const brainDir = "C:/Users/saavi/.gemini/antigravity-ide/brain/440c75bd-47ac-4385-8e86-dd698e446ae6";

const timestamps = [
  { sec: 2.5, name: "final_master_01_hook_2.5s.png" },
  { sec: 6.0, name: "final_master_02_zoom_6.0s.png" },
  { sec: 15.0, name: "final_master_03_mechanism_15.0s.png" },
  { sec: 25.0, name: "final_master_04_massage_25.0s.png" },
  { sec: 42.0, name: "final_master_05_warning_42.0s.png" },
  { sec: 58.0, name: "final_master_06_cta_58.0s.png" },
];

async function extract() {
  for (const t of timestamps) {
    const out = path.join(brainDir, t.name);
    await new Promise<void>((resolve, reject) => {
      ffmpeg(masterVideo)
        .setStartTime(t.sec)
        .frames(1)
        .output(out)
        .outputOptions(["-y"])
        .on("end", () => {
          console.log(`✓ Saved ${t.name} at ${t.sec}s`);
          resolve();
        })
        .on("error", (err) => reject(err))
        .run();
    });
  }
}

extract().then(() => console.log("All keyframes extracted successfully!"));
