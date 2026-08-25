# Process overview

## What I built

I built a sonic garden that works as a browser instrument. The player can choose five plants: flower, grass, tree, mushroom and reed. Clicking the soil grows a plant and adds its sound to the garden. Dragging with the watering can changes the sound, while the shovel removes plants. The reset button clears the garden.

Each species has its own pitch range and sound character. All notes stay inside the same pentatonic scale, so different plants can be combined without creating obviously wrong notes. Mature plants keep sounding, so the garden slowly becomes a layered composition.

## The moments that mattered

### 1. The first version worked, but it did not feel like an instrument

The first planting interaction passed the tests. I could click the soil, grow a plant and hear a sound. However, when I played it myself, every plant only made a short sound. The garden never built up into anything.

My original plan said plants should eventually fade. I decided not to follow that part of the plan. I changed mature plants so they stay in the garden and keep a quiet sustained sound. I also limited the number of active voices so the sound would not become too loud.

After this change, planting several plants started to create an actual layered piece.

[`0655626`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-pengyue-Stella/commit/0655626) → [`639c710`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-pengyue-Stella/commit/639c710)

### 2. I kept changing the interaction after actually playing it

Watering worked in the code, but it was almost invisible to a new player. I added a visible watering can and a droplet trail so dragging had an immediate visual response.

I later replaced the hidden plant cycle with a tool tray. This let the player choose a species, water plants, remove plants or reset the garden.

I also found that the first species sounded too similar. I gave them different musical roles and pitch ranges. I then added mushroom and reed as two more voices. The mushroom also gained a sparse rhythmic pulse.

I kept listening after each change instead of judging it only from the tests.

[`fcbe5cc`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-pengyue-Stella/commit/fcbe5cc) → [`2620840`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-pengyue-Stella/commit/2620840)