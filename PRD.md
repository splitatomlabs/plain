# Product Requirements Document  
**Product:** Plain  
**Platform:** iOS  

---

## 1. Problem
Gen Z and Gen Alpha users spend significant time in short form social feeds as a way to process emotions, seek perspective, and pass time. While this content is engaging, it is often low in grounding or reflective value, leaving users feeling mentally scattered rather than clearer or more oriented. Existing alternatives either require high effort, such as books or meditation, or reduce complex ideas to isolated quotes without context or progression. As generative AI increases the volume of fast, derivative content, users have fewer accessible ways to encounter high value ideas that support emotional clarity in the moment.

---

## 2. Why Now
Short form vertical feeds have trained users to consume and share atomic ideas as a core communication mode. At the same time, generative AI is flooding feeds with derivative content, lowering trust and increasing emotional fatigue. Public domain philosophy offers a large, underused supply of high value ideas, and modern AI makes it viable to reinterpret this material into emotionally relevant, accessible language at scale. Plain redirects time spent doom scrolling toward grounding content without asking users to change their behavior.

---

## 3. Goals
- Achieve a high share rate with a target of X shares per DAU  
- Deliver emotional clarity within two taps for first time users  
- Drive repeat engagement through identity anchored Paths  
- Convert engaged users to subscription via prestige access to depth

---

## 4. Non Goals
- No attempt to teach philosophy comprehensively  
- No long form reading as a primary experience  
- No productivity tooling, habit tracking, or coaching features

---

## 5. Target Users
Primary users are Gen Z and early Gen Alpha individuals who are emotionally aware, chronically online, and fluent in short form video culture. They spend most of their time in algorithmic feeds and express meaning through sharing. They use Plain to replace low value scrolling with content that helps them feel grounded, oriented, and socially legible.

---

## 6. User Insights
- Doom scrolling is often driven by emotional discomfort, not boredom  
- Users trust ideas more when they come from culturally respected sources  
- Sharing is a form of emotional regulation and identity signaling  
- Users are more comfortable expressing emotion through private or ephemeral sharing than permanent public posts  
- Progress only feels meaningful when it reflects internal understanding

---

## 7. Core Use Cases
- When I feel unsettled, I want an idea that grounds me immediately  
- When something resonates, I want to share it with my own framing  
- When I return over time, I want to feel like I am building a coherent worldview
- When I feel lonely, I want a lightweight way to feel connection

---

## 8. Product Principles
- Replace low value content, do not compete with it  
- Emotion determines relevance  
- Sharing is the proof of value  
- Depth is earned, not forced

---

## 9. Functional Requirements
- Allow users to select a single word emotional state and receive an insight card within two taps  
- Generate vertically formatted, screenshot ready insight cards designed to look native in short form feeds 
- Surface sharing as the primary action using the native iOS share sheet, optmize for private and ephemeral surfaces
- Enable low friction remixing via tone presets and light text edits  
- Provide curated Paths with 7 to 15 idea nodes from Stoicism or Platonism  
- Tie daily insights to the current Path idea node  
- Treat insight consumption as exposure, not completion  
- Advance idea nodes only after repeated exposure and self confirmation  
- Support ephemeral social signals including presence indicators and short lived reflections tied to ideas  
- Unlock simplified source excerpts only after Path milestones  
- Deliver one daily push notification linked directly to a shareable card, with opt out

---

## 10. User Experience Overview
The user opens Plain, selects how they feel, and immediately receives a grounding insight. The card is designed to be shared first and read second. Over time, insights connect into a Path that creates orientation without pressure. Social presence and progress are ambient, not performative. Depth unlocks gradually as a signal of commitment rather than obligation.

---

## 11. Success Metrics
**Leading metrics**
- Shares per DAU  
- Percentage of sessions that result in a share  
- D1 retention  

**Lagging metrics**
- 7 and 30 day retention  
- Subscription conversion rate  

**Business metric**
- Monthly recurring revenue per engaged user

---

## 12. Risks and Unknowns
- Users may continue defaulting to low value feeds, validated via repeat sharing behavior  
- Remixing may drift tone away from calm and grounding, validated through downstream share performance  
- Paths may feel abstract rather than motivating, validated via Path participation and completion  
- Ephemeral social signals may feel distracting, validated through usage drop off

---

## 13. Dependencies
- AI models for emotional reinterpretation and tone variation  
- Public domain philosophy sources for Stoicism and Platonism  
- Subscription and entitlement infrastructure

---

## 14. Release Plan

### v0 MVP Test
- Emotional check in  
- Single insight card generation  
- Native iOS share sheet  
- Ambient presence indicator showing how many people have recently viewed the same idea  
- No Paths, remixing, or social input

### v1 Launch
- Remixing with tone presets  
  - **Gentle clarity:** soft, non judgmental reframing that reduces emotional intensity  
  - **Grounded realism:** plainspoken, emotionally neutral interpretation  
- Paths with progress visualization  
- Lightweight ephemeral reflections limited to 5 to 7 words per idea, expiring after 24 hours  
- Daily push notification  
- Subscription gated deep reading  
  - Simplified source excerpts unlocked after Path milestones, framed as  
    “This is how the original text expressed the idea you have been practicing”

### v2
- Shareable Path completion artifacts  
- Expanded remix templates  
- Next level Path verification through applied reflection  
  - After confirming an idea node, prompt a short situational reflection such as  
    “Where did you notice this idea show up today?”  
  - A brief response is required to unlock final Path completion
- Additional Paths