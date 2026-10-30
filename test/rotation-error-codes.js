// Every error code the rotation validator and import give (#212), with the
// names of its data fields: the table in docs/rotation.md, "Error codes", as
// the tests read it. A code not listed here is a code the docs do not have.
export const ERROR_DATA = Object.freeze({
  // The shape.
  notAnObject: [],
  badSchemaVersion: [],
  missingField: ["field"],
  unknownField: ["field"],
  nameEmpty: [],
  nameTooLong: ["max"],
  rulesNotArray: [],
  tooManyRules: ["max"],
  ruleNotObject: [],
  actionNotId: [],
  conditionsNotArray: [],
  tooManyConditions: ["max"],
  conditionNotObject: [],
  conditionNoType: [],
  noRules: [],
  // Ability and aura ids.
  unknownAbility: [],
  notCastYet: [],
  notSelfBuff: [],
  debuffAsBuff: [],
  notDebuff: [],
  buffAsDebuff: [],
  // A condition's params.
  unknownConditionType: [],
  missingParam: ["param"],
  badParam: ["param"],
  unknownParam: ["param"],
  // A condition's values.
  notWhole: ["resource"],
  outOfRange: ["resource", "max"],
  negativeSeconds: [],
  badStacks: [],
  tooManyStacks: ["max"],
  // The talent guard.
  talentGuard: ["ability"],
  // The import text as a whole.
  notText: [],
  tooLarge: ["max"],
  notJson: [],
});

// Every warning code rotationWarnings gives (#214), with the names of its
// data fields: the table in docs/rotation.md, "Warning codes".
export const WARNING_DATA = Object.freeze({
  duplicateRule: ["ability", "same"],
  finisherNoComboPoints: ["ability", "condition"],
  cooldownNotChecked: ["ability"],
  grantedNotTalent: ["ability", "condition"],
  unlockedNotTalent: ["ability", "condition"],
  duplicateCondition: ["ability", "condition", "same"],
  starves: ["ability", "below", "reason"],
});
