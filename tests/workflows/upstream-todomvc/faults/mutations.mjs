// Evaluator-only mutations. Never give this file to an agent authoring tests.
// Original upstream files remain unchanged; mutations apply only to served bytes.
import { deletePersistenceLost } from './delete-persistence-lost.mjs';

export const faultNames = Object.freeze([
  'none', 'persistence-lost', 'delete-wrong-duplicate',
  'filter-state-error', 'escape-commits-edit', 'delete-persistence-lost',
]);

function replaceOnce(source, from, to, fault) {
  if (source.split(from).length !== 2)
    throw new Error(`Mutation ${fault} no longer matches exactly one upstream location`);
  return source.replace(from, to);
}

export function mutateSource(path, bytes, fault) {
  if (!faultNames.includes(fault)) throw new Error(`Unknown TodoMVC fault: ${fault}`);
  if (fault === 'none') return bytes;
  let text = bytes.toString('utf8');
  if (fault === 'persistence-lost' && path === '/js/store.js') {
    text = replaceOnce(text, 'if (!localStorage.getItem(name)) {', 'if (true) {', fault);
  } else if (fault === 'delete-persistence-lost' && path === '/js/store.js') {
    text = deletePersistenceLost(text);
  } else if (fault === 'delete-wrong-duplicate' && path === '/js/store.js') {
    text = replaceOnce(text,
      'Store.prototype.remove = function (id, callback) {\n\t\tvar todos = JSON.parse(localStorage.getItem(this._dbName));',
      'Store.prototype.remove = function (id, callback) {\n\t\tvar todos = JSON.parse(localStorage.getItem(this._dbName));\n\t\tvar requested = todos.filter(function (todo) { return todo.id == id; })[0];', fault);
    text = replaceOnce(text, 'if (todos[i].id == id) {',
      'if (requested && todos[i].title === requested.title) {', fault);
  } else if (fault === 'filter-state-error' && path === '/js/controller.js') {
    text = replaceOnce(text, 'self.model.read({ completed: false }, function (data) {',
      'self.model.read({ completed: true }, function (data) {', fault);
  } else if (fault === 'escape-commits-edit' && path === '/js/controller.js') {
    text = replaceOnce(text, 'self.editItemCancel(item.id);',
      "self.editItemSave(item.id, self.view.$todoList.querySelector('input.edit').value);", fault);
  }
  return Buffer.from(text);
}
