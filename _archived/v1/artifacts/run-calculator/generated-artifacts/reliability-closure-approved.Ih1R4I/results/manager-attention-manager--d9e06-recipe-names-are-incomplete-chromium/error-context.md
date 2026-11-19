# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: manager-attention.spec.ts >> manager setup stays usable when recipe names are incomplete
- Location: e2e/manager-attention.spec.ts:627:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "403 GET http://127.0.0.1:44355/api/import-gold/retention?limit=100&offset=0",
+ ]
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - complementary "App updates" [ref=e3]:
    - generic [ref=e4]:
      - button "App updates · Development preview" [ref=e5]
      - status [ref=e6]: Development preview. Published updates are not checked in this development preview.
  - main [ref=e7]:
    - generic [ref=e8]:
      - complementary [ref=e9]:
        - group [ref=e10]:
          - generic "2 saved facility-list edits need review" [ref=e11]
      - generic [ref=e12]:
        - generic [ref=e13]:
          - generic [ref=e18]:
            - heading "Production Run Calculator" [level=1] [ref=e19]
            - paragraph [ref=e20]: Pizza line planning & schedule estimation
          - generic [ref=e21]:
            - 'button "Sync status: Synchronized" [ref=e23]':
              - generic [ref=e27]: Synchronized
            - generic: Saved
            - button "Cast to other screens" [ref=e30]
            - button "Enter fullscreen / kiosk mode" [ref=e33]
            - button "Supervisor" [ref=e39]
            - button "More — 1 manager action need attention" [ref=e44]:
              - generic "1 manager actions need attention" [ref=e46]: "1"
        - generic [ref=e47]:
          - status [ref=e48]:
            - generic [ref=e49]: Gold Lab deadline reminders are unavailable. Open the retention register to retry.
            - button "Open retention register" [ref=e50]
          - generic [ref=e51]:
            - group "production-line department" [ref=e52]:
              - tabpanel "Run" [ref=e53]:
                - generic "This device has not adopted a server calculation for the selected run" [ref=e54]: Provisional — awaiting server confirmation
                - button "Line Map" [ref=e56]
                - generic [ref=e61]:
                  - generic [ref=e62]:
                    - generic [ref=e63]: Run 1 of 1
                    - generic [ref=e65]:
                      - generic [ref=e66]: 1/30
                      - button "New Run" [ref=e67]
                  - generic [ref=e70]:
                    - generic [ref=e71]: Run Setup
                    - generic [ref=e76]:
                      - generic [ref=e77]:
                        - generic [ref=e78]: Brand & Flavor
                        - generic [ref=e79]:
                          - textbox "Brand…" [ref=e82] [cursor=pointer]
                          - generic [ref=e83]: —
                          - textbox "Flavor…" [ref=e86] [cursor=pointer]
                      - generic [ref=e87]:
                        - generic [ref=e88]: Target Cases
                        - spinbutton "0" [ref=e93]
                        - paragraph [ref=e94]:
                          - generic [ref=e95]: ⚠
                          - text: Enter cases to enable calculations
                  - button "START RUN" [ref=e96]
                - generic [ref=e99]:
                  - generic [ref=e100]: Line Details
                  - generic [ref=e101]:
                    - generic [ref=e102]:
                      - generic [ref=e103]: Cases Left to Run
                      - generic [ref=e104]: "0"
                    - generic [ref=e105]:
                      - generic [ref=e106]: Approx. Cases on Line
                      - generic [ref=e107]: "0"
                    - generic [ref=e108]:
                      - generic [ref=e109]: Dough Status
                      - generic [ref=e110]: Balanced
                    - generic [ref=e111]:
                      - generic [ref=e112]: Cases on Last Skid
                      - generic [ref=e113]: "0"
                - generic [ref=e114]:
                  - generic [ref=e115]:
                    - heading "Temporary Adjustments" [level=3] [ref=e120]
                    - button "Clear All" [ref=e121]
                  - generic [ref=e122]:
                    - generic [ref=e124]:
                      - generic [ref=e125]: Freeze Tunnel Time
                      - spinbutton "Freeze Tunnel Time" [ref=e130]: "0"
                    - generic [ref=e132]:
                      - generic [ref=e133]: Crusts/Cycle
                      - spinbutton "Crusts/Cycle" [ref=e138]: "0"
                    - generic [ref=e140]:
                      - generic [ref=e141]: Cycle Speed
                      - spinbutton "Cycle Speed" [ref=e146]: "0"
                  - paragraph [ref=e147]: For this run only — leave at 0 to use the Setup value. Setup stays unchanged.
                - group [ref=e148]:
                  - generic "Line Setup" [ref=e149] [cursor=pointer]
            - group "production-line department"
            - tablist [ref=e156]:
              - tab "Run" [selected] [ref=e157]
              - tab "Dough" [ref=e161]
              - tab "Sauce" [ref=e167]
              - tab "Front" [ref=e172]
              - tab "Pack" [ref=e184]
              - tab "Warehouse" [ref=e190]
            - group "production-line department"
            - group "production-line department"
            - group "production-line department"
        - dialog [ref=e196]:
          - generic [ref=e197]:
            - heading "Setup Profiles" [level=2] [ref=e202]
            - button "Close setup profiles" [ref=e203]
          - generic [ref=e208]:
            - generic [ref=e209]:
              - generic [ref=e210]:
                - generic [ref=e211]: Brand
                - button "AttentionBrand_mvxiy124_mjbv1av1" [ref=e213]
              - generic [ref=e217]:
                - generic [ref=e218]: Flavor
                - button "AttentionFlavor_mvxiy124_gmoukhgg" [ref=e220]
            - generic [ref=e224]:
              - generic [ref=e225]: Auto-Fill From Imports
              - generic [ref=e231]:
                - paragraph [ref=e232]: Fill blank fields from all your latest imports — spec sheets, the palletizing guide, and the dough, cheese & mix recipes. Differences are listed for you to review, and when your imports disagree you pick which value to use. Nothing changes without your OK, and nothing is saved until you press Save Setup.
                - button "Check Latest Imports" [ref=e233]
            - group [ref=e234]:
              - generic "Line Settings" [ref=e235] [cursor=pointer]
              - generic [ref=e242]:
                - generic [ref=e243]:
                  - generic [ref=e244]: Line Type
                  - generic [ref=e245]:
                    - button "Dough" [pressed] [ref=e246]
                    - button "Crust" [ref=e247]
                - generic [ref=e248]:
                  - generic [ref=e249]: Die Type
                  - generic [ref=e250]:
                    - button "12\"" [ref=e252]
                    - button "7\" Dies" [ref=e254]
                    - button "+" [ref=e255]
                - generic [ref=e256]:
                  - generic [ref=e257]: Allergen
                  - generic [ref=e258]:
                    - button "None" [ref=e259]
                    - button "Egg Allergen" [ref=e261]
                    - button "Soy Allergen" [ref=e263]
                - generic [ref=e265]:
                  - generic [ref=e266]:
                    - text: Crusts Per Cycle
                    - spinbutton "Crusts Per Cycle" [ref=e267]: "0"
                  - generic [ref=e268]:
                    - text: Cycle Speed (cyc/min)
                    - spinbutton "Cycle Speed (cyc/min)" [ref=e269]: "0"
                - generic [ref=e270]:
                  - generic [ref=e271]:
                    - text: Speed Adjustment
                    - spinbutton "Speed Adjustment" [ref=e272]: "0.92"
                  - generic [ref=e273]:
                    - text: Freeze Tunnel Time (min)
                    - spinbutton "Freeze Tunnel Time (min)" [ref=e274]: "0"
                - generic [ref=e275]:
                  - paragraph [ref=e276]: Draft setup — not ready for case-based runs
                  - paragraph [ref=e277]: Enter a positive Pizzas Per Case value below before scheduling or starting runs that request cases. You can still save this setup as a draft.
                - generic [ref=e278]:
                  - generic [ref=e280]:
                    - text: Pizzas Per Case
                    - spinbutton "Pizzas Per Case" [ref=e281]: "0"
                  - generic [ref=e282]:
                    - text: Cases Per Skid
                    - spinbutton "Cases Per Skid" [ref=e283]: "0"
                - generic [ref=e284]:
                  - generic [ref=e285]:
                    - text: Extra Case Buffer
                    - spinbutton "Extra Case Buffer" [ref=e286]: "0"
                  - generic [ref=e287]:
                    - text: Doughballs Per Tray
                    - spinbutton "Doughballs Per Tray" [ref=e288]: "0"
                - generic [ref=e289]:
                  - text: Dough Batch Yield (doughballs)
                  - spinbutton "Dough Batch Yield (doughballs)" [ref=e290]: "0"
            - group [ref=e291]:
              - generic "Packaging Settings" [ref=e292] [cursor=pointer]
              - generic [ref=e300]:
                - generic [ref=e301]:
                  - generic [ref=e302]: Packaging Type
                  - generic [ref=e303]:
                    - button "Cartoned" [ref=e304]
                    - button "Labeled" [ref=e305]
                    - button "N/A" [ref=e306]
                - generic [ref=e307]:
                  - generic [ref=e308]:
                    - text: Cartons Per Case
                    - spinbutton "Cartons Per Case" [ref=e309]: "0"
                  - generic [ref=e310]:
                    - generic [ref=e311]: Carton Size
                    - generic [ref=e312]:
                      - button "Single (1)" [ref=e313]
                      - button "Double (2)" [ref=e314]
                      - button "Triple (3)" [ref=e315]
                - generic [ref=e316]:
                  - generic [ref=e317]: Circles
                  - generic [ref=e318]:
                    - generic [ref=e319]:
                      - button "none" [ref=e320]
                      - button "Remove none" [ref=e321]
                    - generic [ref=e325]:
                      - button "microwave" [ref=e326]
                      - button "Remove microwave" [ref=e327]
                    - generic [ref=e331]:
                      - button "7in" [ref=e332]
                      - button "Remove 7in" [ref=e333]
                    - generic [ref=e337]:
                      - button "11in" [ref=e338]
                      - button "Remove 11in" [ref=e339]
                    - generic [ref=e343]:
                      - button "12in" [ref=e344]
                      - button "Remove 12in" [ref=e345]
                    - button "+" [ref=e349]
                - generic [ref=e350]:
                  - generic [ref=e351]: Shipper
                  - generic [ref=e352]:
                    - generic [ref=e353]:
                      - button "costco" [ref=e354]
                      - button "Remove costco" [ref=e355]
                    - generic [ref=e359]:
                      - button "12in" [ref=e360]
                      - button "Remove 12in" [ref=e361]
                    - generic [ref=e365]:
                      - button "11in" [ref=e366]
                      - button "Remove 11in" [ref=e367]
                    - generic [ref=e371]:
                      - button "7in" [ref=e372]
                      - button "Remove 7in" [ref=e373]
                    - generic [ref=e377]:
                      - button "edwardos" [ref=e378]
                      - button "Remove edwardos" [ref=e379]
                    - button "+" [ref=e383]
                - generic [ref=e384]:
                  - generic [ref=e385]: Skid Stacking
                  - generic [ref=e386]:
                    - generic [ref=e387]:
                      - button "lucia" [ref=e388]
                      - button "Remove lucia" [ref=e389]
                    - generic [ref=e393]:
                      - button "hannaford" [ref=e394]
                      - button "Remove hannaford" [ref=e395]
                    - generic [ref=e399]:
                      - button "column" [ref=e400]
                      - button "Remove column" [ref=e401]
                    - button "+" [ref=e405]
                - generic [ref=e406]:
                  - generic [ref=e407]: Grip Sheets
                  - generic [ref=e408]:
                    - generic [ref=e409]:
                      - button "none" [ref=e410]
                      - button "Remove none" [ref=e411]
                    - generic [ref=e415]:
                      - button "every other layer" [ref=e416]
                      - button "Remove every other layer" [ref=e417]
                    - generic [ref=e421]:
                      - button "3rd and 5th" [ref=e422]
                      - button "Remove 3rd and 5th" [ref=e423]
                    - button "+" [ref=e427]
                - generic [ref=e428]:
                  - generic [ref=e429]: Slip Sheets
                  - generic [ref=e430]:
                    - button "Yes" [ref=e431]
                    - button "No" [ref=e432]
            - generic [ref=e433]:
              - generic [ref=e436]:
                - generic [ref=e437]: Dough Recipe
                - button "Dough recipe" [ref=e440]:
                  - generic [ref=e441]: Valid Dough
                - generic [ref=e444]: — batches needed
                - generic [ref=e445]:
                  - button "Print recipe" [ref=e446]
                  - button "Share recipe" [ref=e451]
              - generic [ref=e458]:
                - generic [ref=e459]:
                  - generic [ref=e460]:
                    - generic [ref=e461]: Target Weight (oz)
                    - spinbutton "0.00" [ref=e462]
                  - generic [ref=e463]:
                    - paragraph [ref=e464]: Recipe Yield
                    - paragraph [ref=e465]: —
                    - paragraph [ref=e466]: doughballs / batch
                - paragraph [ref=e467]: No ingredients yet. Add rows to build the recipe.
                - button "Add Ingredient" [ref=e468]
            - generic [ref=e470]:
              - button "Sauce & Applicator Weights" [ref=e471]
              - generic [ref=e476]:
                - generic [ref=e477]:
                  - paragraph [ref=e478]: Sauce
                  - button "Sauce recipe" [ref=e480]:
                    - generic [ref=e481]: Valid Sauce
                - generic [ref=e484]:
                  - generic [ref=e485]:
                    - text: Oz Per Pizza
                    - spinbutton "Oz Per Pizza" [ref=e486]: "0"
                  - generic [ref=e487]:
                    - text: Barrel Weight (lbs)
                    - spinbutton "Barrel Weight (lbs)" [ref=e488]: "0"
                - generic [ref=e489]:
                  - generic [ref=e490]: Sauce Recipe
                  - button "Sauce recipe ingredients" [ref=e493]:
                    - generic [ref=e494]: Valid Sauce
                  - generic [ref=e497]:
                    - button "Print recipe" [ref=e498]
                    - button "Share recipe" [ref=e503]
                - paragraph [ref=e510]: No ingredients yet. Add rows to build the recipe.
                - button "Add Ingredient" [ref=e511]
                - generic [ref=e513]:
                  - generic [ref=e515]:
                    - paragraph [ref=e516]: Applicator 1
                    - button "Applicator 1" [ref=e518]:
                      - generic [ref=e519]: Mix
                  - generic [ref=e523]:
                    - text: Oz Per Pizza
                    - spinbutton "Oz Per Pizza" [ref=e524]: "0"
                  - generic [ref=e525]:
                    - generic [ref=e526]: Mix — Mix Recipe
                    - generic [ref=e527]: 0.0 lbs needed
                    - generic [ref=e528]:
                      - button "Print recipe" [ref=e529]
                      - button "Share recipe" [ref=e534]
                  - button "Applicator 1 mix recipe" [ref=e543]:
                    - generic [ref=e544]: Valid Mix
                  - paragraph [ref=e547]: No ingredients yet. Add rows to build the mix.
                  - button "Add Ingredient" [ref=e548]
                - generic [ref=e552]:
                  - paragraph [ref=e553]: Applicator 2
                  - button "Applicator 2" [ref=e555]:
                    - generic [ref=e556]: Select…
                - generic [ref=e560]:
                  - paragraph [ref=e561]: Pep Applicator 1 & 2
                  - button "Pep Applicator 1 & 2" [ref=e563]:
                    - generic [ref=e564]: Select…
                - generic [ref=e567] [cursor=pointer]:
                  - checkbox "Run this pep through both applicators 1 & 2 (doubles stick buffer)" [checked] [ref=e568]
                  - generic [ref=e569]: Run this pep through both applicators 1 & 2 (doubles stick buffer)
                - button "+ Add pep type" [ref=e570]
                - generic [ref=e573]:
                  - paragraph [ref=e574]: Applicator 3
                  - button "Applicator 3" [ref=e576]:
                    - generic [ref=e577]: Select…
                - generic [ref=e582]:
                  - paragraph [ref=e583]: Applicator 4
                  - button "Applicator 4" [ref=e585]:
                    - generic [ref=e586]: Select…
            - generic [ref=e589]:
              - button "Close" [ref=e590]
              - button "Save Setup" [ref=e591]
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
  678 |             id: uniqueTestId("scheduled-incomplete"),
  679 |             brand: scheduledBrand,
  680 |             flavor: scheduledFlavor,
  681 |             casesNeeded: 10,
  682 |             dieType: "",
  683 |           }],
  684 |         }]),
  685 |       }));
  686 |     await page.route("**/api/master-data/bootstrap*", (route) =>
  687 |       route.fulfill({
  688 |         status: 200,
  689 |         contentType: "application/json",
  690 |         body: JSON.stringify({
  691 |           ingredients: [],
  692 |           doughRecipes: [
  693 |             { id: uniqueTestId("malformed-dough"), name: null, components: [], enabled: true },
  694 |             { id: uniqueTestId("valid-dough"), name: "Valid Dough", components: [], enabled: true },
  695 |           ],
  696 |           sauceRecipes: [
  697 |             { id: uniqueTestId("malformed-sauce"), name: 42, components: [], enabled: true },
  698 |             { id: uniqueTestId("valid-sauce"), name: "Valid Sauce", components: [], enabled: true },
  699 |           ],
  700 |           cheeseRecipes: [
  701 |             { id: uniqueTestId("malformed-cheese"), name: {}, components: [], enabled: true },
  702 |             { id: uniqueTestId("valid-cheese"), name: "Valid Cheese", brand: "", flavors: [], components: [], enabled: true },
  703 |           ],
  704 |           mixes: [
  705 |             { id: uniqueTestId("malformed-mix"), name: false, components: [], enabled: true },
  706 |             { id: uniqueTestId("valid-mix"), name: "Valid Mix", brand: "", flavor: "", components: [], enabled: true },
  707 |           ],
  708 |         }),
  709 |       }));
  710 |     await page.addInitScript(() => {
  711 |       localStorage.setItem("run-calc-dough-recipe-names", JSON.stringify([null, "Legacy Dough"]));
  712 |       localStorage.setItem("run-calc-frontline-recipe-names", JSON.stringify([{}, "Legacy Sauce"]));
  713 |     });
  714 | 
  715 |     await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
  716 |     const bootstrapRead = page.waitForResponse(
  717 |       (response) =>
  718 |         response.request().method() === "GET"
  719 |         && response.url().includes("/api/master-data/bootstrap"),
  720 |       { timeout: 25_000 },
  721 |     );
  722 |     await page.goto("/", { waitUntil: "domcontentloaded" });
  723 |     await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  724 |     await expect((await bootstrapRead).status()).toBe(200);
  725 |     await openManagerAttention(page);
  726 |     await page.getByTestId("manager-attention-action-recipe-setup").click();
  727 |     await expect(page.getByRole("heading", { name: "Setup Profiles" })).toBeVisible();
  728 |     await expect(page.getByText(scheduledBrand, { exact: true })).toBeVisible();
  729 |     await expect(page.getByText(scheduledFlavor, { exact: true })).toBeVisible();
  730 | 
  731 |     const openPickerAndSelect = async (
  732 |       picker: Locator,
  733 |       validName: string,
  734 |       malformedName: string,
  735 |     ) => {
  736 |       await picker.click();
  737 |       const dropdown = page.getByPlaceholder("Search or add…").locator("..");
  738 |       await expect(dropdown.getByRole("button", { name: validName, exact: true })).toBeVisible();
  739 |       await expect(dropdown.getByText(malformedName, { exact: true })).toHaveCount(0);
  740 |       await dropdown.getByRole("button", { name: validName, exact: true }).click();
  741 |       // The trigger keeps its stable accessible label (for example
  742 |       // "Dough recipe") after selection; the chosen recipe is its content,
  743 |       // not its accessible name. Assert the picker contract directly instead
  744 |       // of looking for a second button named after the selected recipe.
  745 |       await expect(picker).toContainText(validName);
  746 |     };
  747 | 
  748 |     await openPickerAndSelect(
  749 |       page.getByTestId("setup-recipe-picker-dough"),
  750 |       "Valid Dough",
  751 |       "null",
  752 |     );
  753 | 
  754 |     const saucePicker = page.getByTestId("setup-recipe-picker-sauce");
  755 |     await openPickerAndSelect(saucePicker, "Valid Sauce", "42");
  756 | 
  757 |     const app1TypePicker = page.getByText("Applicator 1", { exact: true }).locator("..").getByRole("button");
  758 |     await app1TypePicker.click();
  759 |     let dropdown = page.getByPlaceholder("Search or add…").locator("..");
  760 |     await expect(dropdown.getByRole("button", { name: "Cheese", exact: true })).toBeVisible();
  761 |     await dropdown.getByRole("button", { name: "Cheese", exact: true }).click();
  762 | 
  763 |     const cheeseRecipePicker = page.getByTestId("setup-recipe-picker-app-1-cheese");
  764 |     await expect(cheeseRecipePicker.locator("option", { hasText: "Valid Cheese" })).toHaveCount(1);
  765 |     await expect(cheeseRecipePicker.locator("option", { hasText: "[object Object]" })).toHaveCount(0);
  766 |     await cheeseRecipePicker.selectOption("Valid Cheese");
  767 |     await expect(cheeseRecipePicker).toHaveValue("Valid Cheese");
  768 | 
  769 |     await app1TypePicker.click();
  770 |     dropdown = page.getByPlaceholder("Search or add…").locator("..");
  771 |     await dropdown.getByRole("button", { name: "Mix", exact: true }).click();
  772 |     await openPickerAndSelect(
  773 |       page.getByTestId("setup-recipe-picker-app-1-mix"),
  774 |       "Valid Mix",
  775 |       "false",
  776 |     );
  777 | 
> 778 |     expect(browserErrors).toEqual([]);
      |                           ^ Error: expect(received).toEqual(expected) // deep equality
  779 |   } finally {
  780 |     await fixtures.cleanup();
  781 |   }
  782 | });
  783 | test("live and setup profile recipe pickers keep the shared selector contract", async ({
  784 |   page,
  785 |   playwright,
  786 | }) => {
  787 |   test.setTimeout(120_000);
  788 |   const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);
  789 | 
  790 |   const incidentIds: string[] = [];
  791 | 
  792 |   try {
  793 |     const account = await fixtures.createAccount({
  794 |       username: uniqueTestId("e2e_manager_attention"),
  795 |       password: PASSWORD,
  796 |       capabilities: DEFAULT_MANAGER_CAPABILITIES,
  797 |       onboardingSeen: true,
  798 |     });
  799 | 
  800 |     const description = `Keyboard queue exit ${uniqueTestId("incident").slice(-8)}`;
  801 |     const brand = uniqueTestId("RecipeRoundTripBrand");
  802 |     const flavor = uniqueTestId("RecipeRoundTripFlavor");
  803 | 
  804 |     const oldCheeseName = uniqueTestId("RecipeRoundTripOldCheese");
  805 |     const oldMixName = uniqueTestId("RecipeRoundTripOldMix");
  806 |     const doughName = uniqueTestId("PickerContractDough");
  807 |     const sauceName = uniqueTestId("PickerContractSauce");
  808 |     const cheeseName = uniqueTestId("PickerContractCheese");
  809 |     const mixName = uniqueTestId("PickerContractMix");
  810 |     const savedCheeseName = uniqueTestId("PickerSavedCheese");
  811 |     const savedMixName = uniqueTestId("PickerSavedMix");
  812 |     const runId = uniqueTestId("picker-contract-run");
  813 |     const now = Date.now();
  814 |     const values = {
  815 |       casesNeeded: 1,
  816 |       pizzasPerCase: 1,
  817 |       casesPerSkid: 1,
  818 |       crustsPerCycle: 1,
  819 |       cycleSpeed: 1,
  820 |       speedAdjustment: 1,
  821 |       app1Type: "Cheese",
  822 |       app1CheeseRecipeName: oldCheeseName,
  823 |       app1CheeseRecipe: [{ ingredient: "Old Cheese", lbs: 10 }],
  824 |       app2Type: "Mix",
  825 |       app2CheeseRecipeName: oldMixName,
  826 |       app2CheeseRecipe: [{ ingredient: "Old Mix", lbs: 10 }],
  827 |       app3Type: "Cheese",
  828 |       app3CheeseRecipeName: oldCheeseName,
  829 |       app3CheeseRecipe: [{ ingredient: "Old Cheese", lbs: 10 }],
  830 |       app4Type: "Mix",
  831 |       app4CheeseRecipeName: oldMixName,
  832 |       app4CheeseRecipe: [{ ingredient: "Old Mix", lbs: 10 }],
  833 |     };
  834 | 
  835 |     const openSetupProfiles = async () => {
  836 |       await page.getByRole("button", { name: /^More/ }).click();
  837 |       await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  838 |       const settings = page.getByRole("dialog", { name: "Manage Lists & Settings" });
  839 |       await expect(settings).toBeVisible();
  840 |       await settings.getByRole("button", { name: "Tools", exact: true }).click();
  841 |       await settings.getByRole("button", { name: "Setup Profiles", exact: true }).click();
  842 |       await settings.getByRole("button", { name: "Open Setup Profiles Editor", exact: true }).click();
  843 | 
  844 |       const profileSurface = page.getByRole("dialog", { name: "Setup Profiles" });
  845 |       await expect(profileSurface).toBeVisible();
  846 |       return profileSurface;
  847 |     };
  848 | 
  849 |     await fixtures.seedNamedRecipe("dough", account, {
  850 |       id: uniqueTestId("picker-contract-dough"),
  851 |       name: doughName,
  852 |       components: [{ ingredient: "Flour", lbs: 10 }],
  853 |     });
  854 |     await fixtures.seedNamedRecipe("sauce", account, {
  855 |       id: uniqueTestId("picker-contract-sauce"),
  856 |       name: sauceName,
  857 |       components: [{ ingredient: "Tomato", lbs: 10 }],
  858 |     });
  859 |     await fixtures.seedCheeseRecipe(account, {
  860 |       id: uniqueTestId("picker-contract-cheese"),
  861 |       name: cheeseName,
  862 |       components: [{ ingredient: "Cheese", lbs: 10 }],
  863 |     });
  864 |     await fixtures.seedCheeseRecipe(account, {
  865 |       id: uniqueTestId("picker-saved-cheese"),
  866 |       name: savedCheeseName,
  867 |       components: [{ ingredient: "Saved Cheese", lbs: 10 }],
  868 |     });
  869 |     await fixtures.seedMix(account, {
  870 |       id: uniqueTestId("picker-contract-mix"),
  871 |       name: mixName,
  872 |       components: [{ ingredient: "Blend", perPizza: 1 }],
  873 |     });
  874 |     await fixtures.seedMix(account, {
  875 |       id: uniqueTestId("picker-saved-mix"),
  876 |       name: savedMixName,
  877 |       components: [{ ingredient: "Saved Blend", perPizza: 1 }],
  878 |     });
```