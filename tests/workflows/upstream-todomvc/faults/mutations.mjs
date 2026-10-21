// Evaluator-only mutations. Never give this file to an agent authoring tests.
// Original upstream files remain unchanged; mutations apply only to served bytes.
import { deletePersistenceLost } from './delete-persistence-lost.mjs';

export const faultNames = Object.freeze([
  'none', 'persistence-lost', 'delete-wrong-duplicate',
  'filter-state-error', 'escape-commits-edit', 'delete-persistence-lost',
  'delayed-render', 'layout-shift', 'redesign-classes',
]);

// A front-end redesign: the same behavior behind renamed class hooks. Applied to every
// served HTML, JS and CSS file so the app keeps working while selector-based tests break.
const redesign = [
  ['clear-completed', 'purge-done'], ['toggle-all', 'check-all'], ['new-todo', 'task-entry'],
  ['todo-list', 'task-list'], ['todo-count', 'task-count'], ['todoapp', 'taskapp'],
  ['toggle', 'check-done'], ['destroy', 'remove-task'], ['filters', 'filter-tabs'], ['edit', 'task-edit'],
];

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
  } else if (fault === 'delayed-render' && (path === '/' || path === '/index.html')) {
    // The app shell is hidden until a slow bootstrap reveals it (inline styles are CSP-allowed).
    text = replaceOnce(text, '<link rel="stylesheet" href="node_modules/todomvc-app-css/index.css">',
      '<link rel="stylesheet" href="node_modules/todomvc-app-css/index.css">\n\t\t<style>.todoapp { visibility: hidden; }</style>', fault);
  } else if (fault === 'delayed-render' && path === '/js/app.js') {
    text = replaceOnce(text, "\t$on(window, 'hashchange', setView);\n})();",
      "\t$on(window, 'hashchange', setView);\n\tsetTimeout(function () { document.querySelector('.todoapp').style.visibility = 'visible'; }, 2500);\n})();", fault);
  } else if (fault === 'redesign-classes' && (path === '/' || /\.(?:html|js|css)$/.test(path))) {
    // Only hooks are renamed: a token after `.`, `#` or a quote. Visible prose such as "Double-click to edit" stays.
    for (const [from, to] of redesign) text = text.replace(new RegExp(`(?<=[.#"'])${from}(?![\\w-])`, 'g'), to);
  } else if (fault === 'layout-shift' && path === '/js/app.js') {
    // A late banner inserted above the app pushes the whole list down without user input.
    text = replaceOnce(text, "\t$on(window, 'hashchange', setView);\n})();",
      "\t$on(window, 'hashchange', setView);\n\tsetTimeout(function () { var notice = document.createElement('div'); notice.textContent = 'This site uses cookies.'; notice.style.cssText = 'height:240px;background:#fff8dc;'; document.body.insertBefore(notice, document.body.firstChild); }, 400);\n})();", fault);
  }
  return Buffer.from(text);
}
