# Location Display Logic

Arliss's guidance: "(neighborhood and location only if its additive to the event [a cool office or a known hub])"

## What we can do programmatically

- Maintain a list of **known hubs** (mHUB, 1871, TeamWorking by TechNexus, Pumping Station One, Atomic Object, etc.) and always show those by name
- Detect **recognizable venue names** (bars, restaurants, coworking spaces) vs bare street addresses
- Suppress "Register to See Address" and "Chicago, Illinois" (no real info)
- For events at generic addresses, show just the neighborhood (River North, Fulton Market, Loop, etc.) or nothing

## What's harder to automate

- Deciding what counts as a "cool office" is subjective — is "Drive Capital, Fulton East Building" additive? Probably yes. Is "200 E Randolph St"? Probably not without the venue name.
- Some events are *at* a venue that matters to the audience (like a brewery for a social) vs a random conference room

## Open questions

1. Should this be a **display-level** decision (keep full location in DB, but only show the "additive" part in the frontend/email) or should we actually strip the DB data down?
2. Do we have a list of known hubs/venues we'd always want shown? Starting candidates from current data: mHUB, 1871, TechNexus, Pumping Station One, Atomic Object, South Side Hackerspace, Polsky Exchange, Association Forum
3. For events at places that aren't known hubs — should we fall back to just the neighborhood, or hide location entirely?
