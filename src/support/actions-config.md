| id | label | description | Playwright steps (summary) | handler |
|----|-------|-------------|-----------------------------|---------|
| turn_on_plug | Turn On Plug | Ensure the plug is turned on by checking the plug switch on the plug page. | goto /plug → wait for checkbox → check if not checked → save screenshot | checkPlug |
| turn_off_plug | Turn Off Plug | Ensure the plug is turned off by unchecking the plug switch on the plug page. | goto /plug → wait for checkbox → uncheck if checked → save screenshot | uncheckPlug |
| toggle_plug | Toggle Plug | Toggle the plug switch state (on ↔ off). | goto /plug → wait for checkbox → click switch → save screenshot | togglePlug |
| refresh_power_data | Refresh Power Data | Open the general/power tab and extract current power readings. | open 'Obecné' tab → extract numeric power values → save screenshot | extractPowerData |
| take_screenshot | Take Screenshot | Capture a full-page screenshot of the current page for debugging. | saveScreenshot(page, '<name>') | saveScreenshot |

Notes:
- The `handler` field maps to the implementing function (or intent) in `src/services/playwrightActions.ts`.
- This file is intended as human-facing documentation for the saved configuration in `actions-config.json`.
