# AI Response Schema (Gemini/OpenRouter contract)

```json
{
  "type": "object", "required": ["imageAssessment","diseaseCode","confidenceBand","visualFindings"],
  "properties": {
    "imageAssessment": {"enum": ["OK","NOT_A_PLANT","WRONG_CROP_SUSPECTED","TOO_UNCLEAR"]},
    "diseaseCode": {"type":"string"},                  // validated ∈ allowedCodes ∪ {"UNKNOWN"} server-side
    "confidenceBand": {"enum": ["HIGH","MEDIUM","LOW"]},
    "visualFindings": {"type":"array","items":{"type":"string","maxLength":140},"maxItems":5},
    "severityVisual": {"enum": ["MILD","MODERATE","SEVERE","NOT_ASSESSABLE"]},
    "affectedParts": {"type":"array","items":{"enum":["LEAF","STEM","FRUIT","FLOWER","WHOLE_PLANT"]}}
  }
}
```
Server mapping: confidenceBand → numeric band {HIGH:0.85, MEDIUM:0.65, LOW:0.4} for uniform downstream handling (band provenance kept — never presented as a measured probability; UI shows "AI-assisted: medium confidence"). imageAssessment ≠ OK → designed UX branches (retake guidance / crop-mismatch prompt), no diseaseCode used. severityVisual feeds the severity assessment ENGINE as one input alongside follow-up answers — engine output is what's shown (model-fabricated severity never surfaces directly).
Validation: Zod mirror of this schema; unknown fields stripped; oversize arrays truncated; parse failure → tier-down. Same contract for OpenRouter tier (prompt-embedded JSON instruction + identical server validation).
