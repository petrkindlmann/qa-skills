// Evaluator-only fault: removal changes the in-page store but is not persisted.
// A later ordinary save writes the current cache, potentially masking the defect.
// The original upstream file is never changed.
function replaceOnce(source, from, to) {
  if (source.split(from).length !== 2)
    throw new Error('Mutation delete-persistence-lost no longer matches exactly one upstream location');
  return source.replace(from, to);
}

export function deletePersistenceLost(source) {
  source = replaceOnce(source, "\t'use strict';", `\t'use strict';

\tvar persistentStorage = window.localStorage;
\tvar pendingDeletions = Object.create(null);
\tvar localStorage = {
\t\tgetItem: function (name) {
\t\t\treturn Object.prototype.hasOwnProperty.call(pendingDeletions, name)
\t\t\t\t? pendingDeletions[name] : persistentStorage.getItem(name);
\t\t},
\t\tsetItem: function (name, value) {
\t\t\tpersistentStorage.setItem(name, value);
\t\t\tdelete pendingDeletions[name];
\t\t}
\t};`);

  const removeStart = source.indexOf('\tStore.prototype.remove = function (id, callback) {');
  const removeEnd = source.indexOf('\n\t};', removeStart);
  if (removeStart < 0 || removeEnd < 0)
    throw new Error('Mutation delete-persistence-lost cannot find Store.remove');
  const originalRemove = source.slice(removeStart, removeEnd);
  const alteredRemove = replaceOnce(originalRemove,
    '\t\tlocalStorage.setItem(this._dbName, JSON.stringify(todos));',
    '\t\tpendingDeletions[this._dbName] = JSON.stringify(todos);');
  return replaceOnce(source, originalRemove, alteredRemove);
}
