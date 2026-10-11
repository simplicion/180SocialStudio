# Brand Consciousness API

Status: implemented (WS1, 2026-09-25). Base URL: `/api/v1/social-media` (auth: the usual bearer token; the
company comes from the token). Source of truth:
`packages/domains/social-media/src/brand-consciousness.ts` (model, validation, prompt builder) and
`apps/backend/src/api/v1/social-media/projects/social-project.routes.ts` (routes).

## Rules the server enforces

1. **Only what the user gave is stored.** There are no invented values: no default positioning, colours, font,
   platforms, tone or audience. Anything not given comes back as `null` (scalars) or `[]` (lists).
2. **`completeness` says what is missing.** The UI should ask the user for `missingRequired` fields. Agents are told
   not to invent them.
3. **Rendering defaults are applied at use time only.** `resolveBrandRendering()` fills gaps with neutral values
   (`#111111`, `#666666`, `#FFFFFF`, `#111111`, Inter, `MINIMAL_SUBTITLE`, no watermark). It lists which ones it
   filled in `usedDefaults` and never saves them.
4. **Tenant scoped.** Every request checks that the project belongs to the caller's company. A project from another
   company, or one that does not exist, returns `404 PROJECT_NOT_FOUND`.

## Fields

| Field | Type | Limits and rules | Required for `isComplete` |
|---|---|---|---|
| `brandName` | string \| null | ≤120 chars. The name the audience knows. Falls back to `projectName` in prompts only. | recommended |
| `brandType` | `"company"` \| `"creator"` \| `"agency"` \| null | | **yes** |
| `positioning` | string \| null | ≤500 | **yes** |
| `tagline` | string \| null | ≤160 | recommended |
| `description` | string \| null | ≤2000. What the brand does. It is separate from the project's `description`. | **yes** |
| `ideation` | string \| null | ≤2000. The big idea or story. | optional |
| `ideology` | string \| null | ≤2000. Beliefs and values. | recommended |
| `colors.primary` | `#RRGGBB` \| null | Must match `^#[0-9A-Fa-f]{6}$`. Returned in upper case. | **yes** |
| `colors.accent` / `.background` / `.text` | `#RRGGBB` \| null | same rule | recommended |
| `logoUrl` | string \| null | http(s) URL. Set it through the logo upload endpoint. PUT accepts only `null` to remove it or an existing URL. | recommended |
| `font` | one of the fonts listed below \| null | Case-insensitive on input. | recommended |
| `tone` | string \| null | ≤200 | **yes** |
| `audience` | string \| null | ≤1000 | **yes** |
| `forbiddenWords` | string[] | ≤100 entries, each ≤60. Trimmed and de-duplicated (case-insensitive). | optional |
| `ctas` | string[] | ≤20 entries, each ≤200 | recommended |
| `hashtags` | string[] | ≤30. Stored as `#tag`, where the tag uses letters, numbers and `_` only. `coffee`, `#coffee` and `##coffee` all become `#coffee`. | recommended |
| `contentPillars` | string[] | ≤12 entries, each ≤80 | recommended |
| `sampleViralPosts` | string[] | ≤10 entries, each ≤3000 | optional |
| `targetPlatforms` | string[] | `instagram`, `facebook`, `youtube`, `linkedin`, `twitter`, `tiktok`. Aliases: `x`→`twitter`, `youtube_shorts`→`youtube`, `ig`, `fb`. | **yes** (at least one) |
| `captionStylePreset` | `HORMOZI_BOUNCE` \| `ALI_ABDAAL_CLEAN` \| `MINIMAL_SUBTITLE` \| `BOLD_CENTER` \| null | These are the presets the EditIR compiler can render. | recommended |
| `watermarkEnabled` | boolean \| null | `null` means the user has not chosen. | optional |
| `customGuidelines` | string \| null | ≤4000 | optional |
| `website` | http(s) URL \| null | ≤2048, must parse as a URL | recommended |
| `industry` | string \| null | ≤120. Used by autopilot research. | recommended |
| `country` | ISO-3166 alpha-2 \| null | `in` becomes `IN` | recommended |
| `language` | BCP-47 \| null | Canonicalised: `en-us` becomes `en-US` | recommended |
| `colors.secondary` | `#RRGGBB` \| null | Same rule as the other colours. It is never given a render default: `resolveBrandRendering().secondaryColor` is `null` when unset. | optional |
| `restrictions` | `{ forbiddenTopics: string[], claimsToAvoid: string[], regulatoryNotes: string\|null }` | ≤50×120 topics, ≤50×200 claims, notes ≤2000. Merges per key on PUT; `null` clears all three. | optional |
| `postingFrequency` | `{ perWeek: number\|null, platforms?: Record<platform, number> }` | 0..100 per week. Platform keys take the same aliases as `targetPlatforms`. Merges per key; `platforms: null` removes the map. | `postingFrequency.perWeek` recommended |
| `objectives` | `{ primary: string\|null, secondary: string\|null }` | ≤300 each. Autopilot uses them as plan goals when a run gives none. | `objectives.primary` recommended |
| `autonomy` | `{ editing: "AUTO"\|"ASSISTED"\|"MANUAL", publishing: "ASSISTED"\|"MANUAL" }` | Always present in responses. The default is `{editing:"ASSISTED", publishing:"MANUAL"}`: this is a policy default, not brand data, and it is not stored until the user chooses. A PUT merges per key; `null` resets to the default. The AI Director reads `editing` (see the AI_DIRECTOR_CONTRACT addendum of 2026-09-27). `publishing` is stored for clients and the scheduler, and publishing still needs a person. | – |

The response also includes these read-only fields: `projectId`, `projectName`, `updatedAt` (ISO string or null) and
`completeness`.

**Fonts** (all are Google Fonts families): Inter, Roboto, Open Sans, Lato, Montserrat, Poppins, Raleway, Nunito,
Work Sans, DM Sans, Manrope, Plus Jakarta Sans, Outfit, Space Grotesk, IBM Plex Sans, Rubik, Barlow, Archivo,
Oswald, Bebas Neue, Anton, Playfair Display, Merriweather, Lora, Source Serif 4, DM Serif Display.

**Completeness.** `percent` is the share of required and recommended fields that are filled.
`isComplete` is true when `missingRequired` is empty. Field names in these lists use dotted paths such as
`colors.primary`.

## GET `/projects/:id/brand-consciousness`

```http
GET /api/v1/social-media/projects/6f1c…/brand-consciousness
```

`200`

```json
{
  "success": true,
  "brand": {
    "projectId": "6f1c…",
    "projectName": "Acme Coffee social",
    "brandName": "Acme Coffee",
    "brandType": "company",
    "positioning": "Specialty coffee for people who brew at home and want café results.",
    "tagline": "Brew slow. Taste more.",
    "description": null,
    "ideation": null,
    "ideology": "Transparency about sourcing.",
    "colors": { "primary": "#1F3A2E", "accent": "#E0A458", "background": null, "text": null },
    "logoUrl": "https://cdn.example.com/brands/logos/co_123/6f1c…/1727280000000-a1b2c3d4.png",
    "font": "Playfair Display",
    "tone": "Warm, witty, never salesy",
    "audience": null,
    "forbiddenWords": ["cheap"],
    "ctas": ["Shop the new roast"],
    "hashtags": ["#homebrew"],
    "contentPillars": ["Brewing guides"],
    "sampleViralPosts": [],
    "targetPlatforms": ["instagram", "tiktok"],
    "captionStylePreset": null,
    "watermarkEnabled": null,
    "customGuidelines": null,
    "updatedAt": "2026-09-25T10:12:00.000Z",
    "completeness": {
      "percent": 74,
      "isComplete": false,
      "missingRequired": ["description", "audience"],
      "missingRecommended": ["colors.background", "colors.text", "captionStylePreset"]
    }
  }
}
```

If the project has no brand profile yet, the endpoint still returns `200`. Every field is `null` or `[]`, and every
required field is listed in `missingRequired`.

## PUT `/projects/:id/brand-consciousness` (partial update)

- If a field is absent from the body, it is left unchanged.
- `null`, `""` or `[]` clears a field.
- `colors` merges per key. For example, `{"colors":{"accent":null}}` clears only the accent colour.
  `{"colors":null}` clears all four.
- Lists are replaced as a whole.
- Unknown fields are rejected, so typos show up as errors instead of being silently dropped. For compatibility, the
  server also accepts these older names: `brandPositioning`, `brandTagline`, `brandDescription`, `brandIdeation`,
  `brandIdeology`, `brandColors`, `brandLogo`, `brandFont`, `targetAudience`, `defaultHashtags` and `standardCtas`.

```http
PUT /api/v1/social-media/projects/6f1c…/brand-consciousness
Content-Type: application/json

{ "audience": "Home baristas, 25–45", "colors": { "background": "#faf7f2" }, "hashtags": ["coffee", "#homebrew"] }
```

`200` returns `{ "success": true, "brand": { …same shape as GET… } }`.

`400` means validation failed. Nothing is saved.

```json
{
  "success": false,
  "error": "VALIDATION_FAILED",
  "message": "colors.primary: must be a hex colour like #1A2B3C; font: font must be one of: Inter, …",
  "details": [
    { "path": "colors.primary", "message": "must be a hex colour like #1A2B3C" },
    { "path": "font", "message": "font must be one of: Inter, Roboto, …" }
  ]
}
```

Other errors: `401 COMPANY_REQUIRED`, `404 PROJECT_NOT_FOUND`, `500 BRAND_CONSCIOUSNESS_FAILED`.

## POST `/projects/:id/brand-consciousness/logo`

Multipart upload with exactly one file in the field **`logo`**. Accepted types are `image/png`, `image/jpeg`,
`image/webp` and `image/svg+xml`, up to **2 MB**. The server checks the file's bytes, not just the declared type.
SVG files that contain scripts, event handlers, entities or external references are rejected. The file is stored at
`brands/logos/<companyId>/<projectId>/…` and saved as `logoUrl`. The previous logo is then deleted (best effort).

```http
POST /api/v1/social-media/projects/6f1c…/brand-consciousness/logo
Content-Type: multipart/form-data; boundary=…

logo=<file>
```

`201`

```json
{ "success": true, "logoUrl": "https://cdn.example.com/brands/logos/co_123/6f1c…/1727280000000-a1b2c3d4.png", "brand": { … } }
```

| Status | `error` | When |
|---|---|---|
| 400 | `NO_FILE` / `BAD_UPLOAD` | There is no file, the field name is wrong, or there is more than one file. |
| 404 | `PROJECT_NOT_FOUND` | The project is not in the caller's company. Nothing is uploaded. |
| 413 | `FILE_TOO_LARGE` | The file is over 2 MB. |
| 415 | `UNSUPPORTED_MEDIA` | The type is not allowed, the bytes do not match the declared type, or the SVG is unsafe. |
| 503 | `STORAGE_UNAVAILABLE` | R2 credentials are not configured on the server. No fake URL is ever returned. |
| 502 | `UPLOAD_FAILED` | The storage provider returned an error. Retry. |

Flutter example: `http.MultipartRequest('POST', uri)..files.add(await http.MultipartFile.fromPath('logo', path, contentType: MediaType('image','png')))`.
To remove the logo, send `PUT … {"logoUrl": null}`.

## POST `/projects` (create) with brand fields

The request body shape is backward compatible. The server reads brand fields from all of these places. When the same
field appears in more than one place, the later source wins:

1. `brandProfile.metadata.*`. These are the legacy flat keys. Other keys, such as the mobile app's `hookStyle` and
   `hooks`, are preserved untouched.
2. `brandProfile.{tone, targetAudience, forbiddenWords, defaultHashtags, standardCtas, sampleViralPosts, contentPillars}`.
   This is the current `CreateProjectInput` shape used by the mobile app.
3. Top-level fields in either canonical or legacy form, such as `brandType`, `positioning` or `brandPositioning`,
   `colors` or `brandColors`, `font`, `targetPlatforms`, and so on. The top-level `description` is the **project**
   description. It is not the brand description; send the brand description as `brandDescription` or
   `brandConsciousness.description`.
4. `brandConsciousness: { …same fields as PUT… }`. This is the recommended form for new clients.

```json
{
  "name": "Acme Coffee social",
  "clientName": "Acme Coffee",
  "description": "Q4 launch campaign",
  "brandProfile": { "tone": "Warm, witty", "targetAudience": "Home baristas", "standardCtas": ["Shop now"], "metadata": { "hookStyle": "question" } },
  "brandConsciousness": { "brandType": "company", "positioning": "Specialty coffee for home brewers", "colors": { "primary": "#1F3A2E" }, "targetPlatforms": ["instagram", "x"] },
  "connectedAccountIds": [],
  "settings": { "approvalRequired": true, "defaultTimezone": "UTC" }
}
```

Invalid brand input returns `400 VALIDATION_FAILED` with `details`, the same as PUT. It is checked before anything is
written, so a bad colour never leaves a half-created project. To upload a logo, create the project first and then
call the logo endpoint.

## Legacy brand-voice endpoints

`GET/POST /brand-voice/:projectId` still work and read and write the same row. They now:

- check that the project belongs to the caller's company (`404` if not);
- return empty fields instead of invented defaults when there is no profile yet;
- merge `metadata` instead of replacing it (the `metadata.brand` key is owned by the endpoints above and cannot be
  overwritten from here);
- leave fields unchanged when they are absent from the request.

**Prompt context** (`toPromptContext()`) now adds these lines when the fields are set: `Industry`, `Website`, `Market` (country and language), `Never cover these topics`, `Never make these claims`, `Regulatory notes (must follow)`, `Posting frequency` and `Growth objectives`. Autonomy is never put in prompts.

## For other workstreams (server code)

```ts
import { getProjectBrandConsciousness, resolveBrandRendering, toBrandPromptContext } from '@workspace/social-media';

const brand = await getProjectBrandConsciousness(projectId, companyId); // throws BrandConsciousnessError 404/401
const prompt = brand.toPromptContext();              // concise, no nulls, ends with "Not provided by the brand (do not invent these): …"
const promptTextOnly = brand.toPromptContext({ includeVisual: false });
const render = resolveBrandRendering(brand);          // { colors, font, captionStylePreset, watermarkEnabled, logoUrl, usedDefaults }
```

`SocialProjectService.getProjectBrandConsciousness(projectId, companyId?)` still works and delegates to this function.
For one migration period, the returned object also has **non-enumerable** getters with the old names
(`brandPositioning`, `brandColors`, `brandFont`, `brandLogo`, `brandTagline`, `brandIdeation`, `brandIdeology`,
`targetAudience`, `standardCtas`, `defaultHashtags`). They carry the same user-given values and can be `null`. They
are not in the JSON responses. New code should use the canonical names.

## Storage (no schema change)

The data lives in the project's `BrandVoiceProfile` row:

- The `tone`, `targetAudience`, `forbiddenWords`, `defaultHashtags`, `standardCtas` and `sampleViralPosts` columns
  hold those fields. When a value is not given, `tone` and `targetAudience` are written as `""`, never as the schema
  defaults.
- `metadata.brand` holds everything else and is marked with `v: 2`.
- `metadata.contentPillars` holds the content pillars.

Rows written by the pre-v2 code store flat keys in `metadata`. When those rows are read, values equal to the old
fabricated defaults are treated as not provided: `"Authoritative Industry Leader"`, `#6366F1`, `#EC4899`,
`#090A0E`, `#FFFFFF`, Inter, `HORMOZI_BOUNCE`, watermark `true`, the default platform list, and the tone and audience
`"Professional & Insightful"` and `"General Audience"`. The next save migrates the row to `metadata.brand`.
