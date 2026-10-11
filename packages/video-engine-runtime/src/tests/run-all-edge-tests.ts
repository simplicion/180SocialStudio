import { runTest as test01 } from "./01-edge-rational-time-drift.test";
import { runTest as test02 } from "./02-edge-non-idr-smart-cut.test";
import { runTest as test03 } from "./03-edge-subtitle-collision-overflow.test";
import { runTest as test04 } from "./04-edge-audio-ducking-dynamics.test";
import { runTest as test05 } from "./05-edge-spring-physics-bounds.test";
import { runTest as test06 } from "./06-edge-multitenant-isolation.test";
import { runTest as test07 } from "./07-edge-ai-director-offline-repair.test";
import { runTest as test08 } from "./08-edge-cache-collision-eviction.test";
import { runTest as test09 } from "./09-edge-otio-malformed-recovery.test";
import { runTest as test10 } from "./10-edge-plugin-sandbox-security.test";
import { runTest as test11 } from "./11-media-intelligence-graph.test";
import { runTest as test12 } from "./12-creative-plan-validator.test";
import { runTest as test13 } from "./13-edit-ir-compiler.test";
import { runTest as test14 } from "./14-critic-repair-loop.test";
import { runTest as test15 } from "./15-golden-media-export.test";
import { runClientEdgeCasesTest as test16 } from "./16-client-edge-cases.test";
import { runTest as test17 } from "./17-multi-asset-classification.test";
import { runTest as test18 } from "./18-dynamic-camera-zoom.test";
import { runTest as test19 } from "./19-brand-asset-retriever.test";
import { runTest as test20 } from "./20-multi-asset-project-ingestion.test";
import { runTest as test21 } from "./21-conscious-style-resolver.test";
import { runTest as test22 } from "./22-multicam-podcast-direction.test";
import { runTest as test23 } from "./23-psychoacoustic-4layer-sound.test";
import { runTest as test24 } from "./24-eye-trace-and-narrative-arc.test";
import { runTest as test25 } from "./25-director-intent-scoping.test";
import { runTest as test26 } from "./26-pexels-broll-director-sourcing.test";
import { runTest as test27 } from "./27-zero-footage-autonomous-director.test";
import { runTest as test28 } from "./28-pixabay-multi-stock-decision-engine.test";

async function main() {
  console.log("=================================================================");
  console.log("  180 AUTONOMOUS VIDEO ENGINE - 28 PRODUCTION VERIFICATION TESTS  ");
  console.log("=================================================================");

  const tests = [
    { id: 1, name: "RationalTime Drift Under Fractional NTSC FPS", fn: test01 },
    { id: 2, name: "Non-IDR GOP Boundary Smart-Cut Splicing", fn: test02 },
    { id: 3, name: "Subtitle Collision, Zero Duration & Overflow", fn: test03 },
    { id: 4, name: "Audio Sidechain Ducking Extreme Dynamic Ranges", fn: test04 },
    { id: 5, name: "Analytical Spring Physics Boundary Stability", fn: test05 },
    { id: 6, name: "Multi-Tenant Data Isolation & Security", fn: test06 },
    { id: 7, name: "AI Director Offline Fallback & AST Validation", fn: test07 },
    { id: 8, name: "Content-Addressed Cache Collisions & Corrupt Recovery", fn: test08 },
    { id: 9, name: "OpenTimelineIO (OTIO) Foreign Metadata Recovery", fn: test09 },
    { id: 10, name: "Sandboxed Plugin SDK Capability Security", fn: test10 },
    { id: 11, name: "Media Intelligence Graph & Heuristic Analyzers", fn: test11 },
    { id: 12, name: "Creative Plan Validator & Constraint Enforcement", fn: test12 },
    { id: 13, name: "Deterministic EditIR AST Compiler", fn: test13 },
    { id: 14, name: "AI Critic & Autonomous Repair Loop", fn: test14 },
    { id: 15, name: "Golden Media Export, Audio Ducking & Vertical 9:16 Render", fn: test15 },
    { id: 16, name: "Senior Engineer Client Video Edge-Case Suite", fn: test16 },
    { id: 17, name: "Multi-Asset Ingestion & Semantic Role Auto-Classifier", fn: test17 },
    { id: 18, name: "Dynamic Spring Camera Zoom Engine & Hardware Crop Easing", fn: test18 },
    { id: 19, name: "Autonomous Vector Brand Logo & Web Asset Retriever", fn: test19 },
    { id: 20, name: "Multi-Asset Batch Ingestion (15 Files) & Semantic Assembly", fn: test20 },
    { id: 21, name: "Conscious Director Style Resolver & Research Synthesis", fn: test21 },
    { id: 22, name: "Multi-Cam Podcast Direction, VAD Diarization & Split Edits", fn: test22 },
    { id: 23, name: "4-Layer Psychoacoustic Sound Stage & Look Pipeline", fn: test23 },
    { id: 24, name: "Saccadic Eye-Trace Solver & 5-Phase Narrative Arc", fn: test24 },
    { id: 25, name: "Surgical Intent Scoping, Track Locks & Motion Graphic Generation", fn: test25 },
    { id: 26, name: "Autonomous Pexels HD B-Roll & Stock Photo Sourcing", fn: test26 },
    { id: 27, name: "Zero-Footage Autonomous Video Creation & Cartesia Speech Engine", fn: test27 },
    { id: 28, name: "Pixabay Multi-Resource Sourcing, Anti-Hotlinking & Decision Broker", fn: test28 },
  ];

  let passed = 0;
  const startTime = Date.now();

  for (const t of tests) {
    try {
      // Some suites report failure by returning false instead of throwing.
      const result: unknown = await t.fn();
      if (result === false) throw new Error("suite reported failure (returned false)");
      passed++;
    } catch (err: any) {
      console.error(`\n❌ FAILED [Test ${t.id}]: ${t.name}`);
      console.error(`   Error: ${err.message}\n`);
      process.exit(1);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log("\n=================================================================");
  console.log(`🎉 ALL 28 CRITICAL SYSTEM TESTS PASSED! (${passed}/28 in ${elapsed}s)`);
  console.log("=================================================================\n");
}

main();
