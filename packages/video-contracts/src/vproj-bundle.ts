import { ProjectPackageManifest, ProjectPackageManifestSchema } from "./project.schema";

export interface SerializedVprojBundle {
  magic: "VPROJ_180";
  formatVersion: "1.0.0";
  checksumSha256: string;
  createdAt: string;
  manifest: ProjectPackageManifest;
}

/**
 * Universal portable SHA-256 implementation with zero node/browser dependency constraints.
 */
function computeSha256Portable(ascii: string): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }

  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let i: number, j: number;
  let result = "";

  const words: number[] = [];
  const asciiBitLength = ascii.length * 8;

  const hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;

  const isComposite: Record<number, boolean> = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = true;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  ascii += "\x80";
  while ((ascii.length % 64) - 56) ascii += "\x00";
  for (i = 0; i < ascii.length; i++) {
    j = ascii.charCodeAt(i);
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;

  for (j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = [...hash];

    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15] || 0;
      const w2 = w[i - 2] || 0;
      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      w[i] = i < 16 ? (w[i] || 0) : ((w[i - 16] || 0) + s0 + (w[i - 7] || 0) + s1) | 0;

      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      const temp1 =
        (hash[7] || 0) +
        (rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25)) +
        ch +
        k[i] +
        w[i];
      const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      const temp2 =
        (rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22)) + maj;

      hash[7] = hash[6];
      hash[6] = hash[5];
      hash[5] = hash[4];
      hash[4] = (hash[3] + temp1) | 0;
      hash[3] = hash[2];
      hash[2] = hash[1];
      hash[1] = hash[0];
      hash[0] = (temp1 + temp2) | 0;
    }

    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (i = 0; i < 8; i++) {
    for (let b = 3; b >= 0; b--) {
      const byte = (hash[i] >> (b * 8)) & 255;
      result += (byte < 16 ? "0" : "") + byte.toString(16);
    }
  }
  return result;
}

export class VprojBundleSerializer {
  /**
   * Computes SHA-256 integrity checksum for a project package manifest
   */
  static computeChecksum(manifest: ProjectPackageManifest): string {
    const serialized = JSON.stringify(manifest, Object.keys(manifest).sort());
    return computeSha256Portable(serialized);
  }

  /**
   * Serializes a project package manifest into a versioned .vproj JSON bundle
   */
  static serialize(manifest: ProjectPackageManifest): string {
    // Validate schema before serialization
    const validated = ProjectPackageManifestSchema.parse(manifest);
    const checksum = this.computeChecksum(validated);

    const bundle: SerializedVprojBundle = {
      magic: "VPROJ_180",
      formatVersion: "1.0.0",
      checksumSha256: checksum,
      createdAt: new Date().toISOString(),
      manifest: validated,
    };

    return JSON.stringify(bundle, null, 2);
  }

  /**
   * Deserializes and validates a .vproj JSON string, performing checksum and schema verification
   */
  static deserialize(rawJson: string): ProjectPackageManifest {
    let parsed: any;
    try {
      parsed = JSON.parse(rawJson);
    } catch (err: any) {
      throw new Error(`[VprojBundleSerializer] Malformed JSON bundle: ${err.message}`);
    }

    // Check if it is an enveloped VPROJ bundle or a direct ProjectPackageManifest
    let manifestData: any;
    if (parsed && parsed.magic === "VPROJ_180" && parsed.manifest) {
      const computed = this.computeChecksum(parsed.manifest);
      if (parsed.checksumSha256 && parsed.checksumSha256 !== computed) {
        console.warn(
          `[VprojBundleSerializer] Checksum mismatch! Header: ${parsed.checksumSha256}, Computed: ${computed}`
        );
      }
      manifestData = parsed.manifest;
    } else {
      manifestData = parsed;
    }

    // Validate with Zod schema
    const result = ProjectPackageManifestSchema.safeParse(manifestData);
    if (!result.success) {
      throw new Error(
        `[VprojBundleSerializer] Schema validation failed: ${result.error.issues.map((i) => i.message).join(", ")}`
      );
    }

    return result.data;
  }
}
