import {
  MediaIntelligenceGraph,
  MediaIntelligenceGraphSchema,
  TechnicalMetadata,
  SceneSegment,
  ShotSegment,
  TranscriptWordIntelligence,
  SentenceSegment,
  SpeakerSegment,
  ClassifiedSilence,
  FillerCandidate,
  RepetitionCandidate,
  FaceTrack,
  DetectedObject,
  VisualActivitySegment,
  AudioAnalysisProfile,
  MusicBeatTrack,
  HighlightSegment,
  HookCandidate,
  BrollCandidate,
} from "./media-intelligence.schema";

export interface MediaGraphBuilderParams {
  assetId: string;
  technicalMetadata: TechnicalMetadata;
  scenes?: SceneSegment[];
  shots?: ShotSegment[];
  transcript?: TranscriptWordIntelligence[];
  sentences?: SentenceSegment[];
  speakers?: SpeakerSegment[];
  silences?: ClassifiedSilence[];
  fillers?: FillerCandidate[];
  repetitions?: RepetitionCandidate[];
  faces?: FaceTrack[];
  objects?: DetectedObject[];
  motion?: VisualActivitySegment[];
  visualActivity?: number;
  audioAnalysis?: AudioAnalysisProfile;
  music?: MusicBeatTrack;
  beats?: MusicBeatTrack;
  topics?: string[];
  highlights?: HighlightSegment[];
  candidateHooks?: HookCandidate[];
  candidateBroll?: BrollCandidate[];
  analysisVersion?: string;
}

export class MediaGraphBuilder {
  static build(params: MediaGraphBuilderParams): MediaIntelligenceGraph {
    const rawGraph: MediaIntelligenceGraph = {
      assetId: params.assetId,
      technicalMetadata: params.technicalMetadata,
      scenes: params.scenes || [],
      shots: params.shots || [],
      transcript: params.transcript || [],
      words: params.transcript || [],
      sentences: params.sentences || [],
      speakers: params.speakers || [],
      silences: params.silences || [],
      fillers: params.fillers || [],
      repetitions: params.repetitions || [],
      faces: params.faces || [],
      people: params.faces || [],
      objects: params.objects || [],
      motion: params.motion || [],
      visualActivity: params.visualActivity ?? 0.5,
      audioAnalysis: params.audioAnalysis || {
        overallRmsEnergy: 0.5,
        peakDecibels: -12.0,
        hasSpeech: true,
        hasMusic: false,
        speechRatio: 0.85,
        clippingDetected: false,
      },
      music: params.music || {
        hasMusic: false,
        confidence: 0,
        beatTimestamps: [],
        downbeatTimestamps: [],
        energyCurve: [],
      },
      beats: params.beats || {
        hasMusic: false,
        confidence: 0,
        beatTimestamps: [],
        downbeatTimestamps: [],
        energyCurve: [],
      },
      topics: params.topics || [],
      highlights: params.highlights || [],
      candidateHooks: params.candidateHooks || [],
      candidateBroll: params.candidateBroll || [],
      analysisVersion: params.analysisVersion || "2.0.0",
      generatedAt: new Date().toISOString(),
    };

    return MediaIntelligenceGraphSchema.parse(rawGraph);
  }
}
