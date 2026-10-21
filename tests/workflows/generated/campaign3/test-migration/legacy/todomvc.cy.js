// Legacy Cypress 12 suite kept from the previous QA setup. Cypress is no longer installed in
// this repository, so this file is the migration input, not an executable test.
// TODO_URL pointed at the deployed TodoMVC build; localStorage is the app's only store.
describe('TodoMVC (legacy Cypress suite)', () => {
  beforeEach(() => {
    cy.visit(Cypress.env('TODO_URL'));
    cy.window().then(win => win.localStorage.clear());
    cy.reload();
  });

  const add = (...titles) => titles.forEach(title => cy.get('.new-todo').type(`${title}{enter}`));
  const titles = expected => cy.get('.todo-list li label').should($labels =>
    expect([...$labels].map(label => label.textContent)).to.deep.equal(expected));

  it('creates trimmed non-blank titles in order and clears the entry field', () => {
    add('   ');
    cy.get('.todo-list li').should('have.length', 0);
    add('  Buy café beans  ', 'Call Mei & book <tickets>');
    cy.get('.new-todo').should('have.value', '');
    titles(['Buy café beans', 'Call Mei & book <tickets>']);
    cy.get('.todo-count').should('contain.text', '2 items left');
  });

  it('duplicate titles remain independent through complete, edit and delete', () => {
    add('Buy milk', 'Buy milk', 'Keep receipt');
    cy.get('.todo-list li').eq(1).find('.toggle').check();
    cy.get('.todo-list li').eq(0).find('.toggle').should('not.be.checked');
    cy.get('.todo-count').should('contain.text', '2 items left');
    cy.get('.todo-list li').eq(1).find('label').dblclick();
    cy.get('.todo-list li').eq(1).find('.edit').clear().type('Buy oat milk{enter}');
    cy.get('.todo-list li').eq(1).find('label').should('have.text', 'Buy oat milk');
    cy.get('.todo-list li').eq(1).find('.destroy').click({ force: true });
    titles(['Buy milk', 'Keep receipt']);
    cy.get('.todo-count').should('contain.text', '2 items left');
  });

  it('filters visibly select the correct subset', () => {
    add('Read chapter', 'Return book', 'Reserve sequel');
    cy.get('.todo-list li').eq(1).find('.toggle').check();
    cy.contains('.filters a', 'Active').click();
    titles(['Read chapter', 'Reserve sequel']);
    cy.contains('.filters a', 'Active').should('have.class', 'selected');
    cy.contains('.filters a', 'Completed').click();
    titles(['Return book']);
    cy.contains('.filters a', 'All').click();
    cy.get('.todo-list li').should('have.length', 3);
    cy.get('.todo-count').should('contain.text', '2 items left');
  });

  it('Enter saves an edit and Escape preserves the saved title', () => {
    add('Book train', 'Pack bag');
    cy.get('.todo-list li').eq(0).find('label').dblclick();
    cy.get('.todo-list li').eq(0).find('.edit').clear().type('Book evening train{enter}');
    cy.get('.todo-list li').eq(0).find('label').should('have.text', 'Book evening train');
    cy.get('.todo-list li').eq(1).find('label').dblclick();
    cy.get('.todo-list li').eq(1).find('.edit').clear().type('Discard this draft{esc}');
    cy.get('.todo-list li').eq(1).find('label').should('have.text', 'Pack bag');
    cy.reload();
    titles(['Book evening train', 'Pack bag']);
  });

  it('items and their completion persist through reload', () => {
    add('Water plants', 'Call dentist');
    cy.get('.todo-list li').eq(0).find('.toggle').check();
    cy.reload();
    cy.get('.todo-list li').should('have.length', 2);
    cy.get('.todo-list li').eq(0).find('.toggle').should('be.checked');
    cy.get('.todo-list li').eq(1).find('.toggle').should('not.be.checked');
    cy.get('.todo-count').should('contain.text', '1 item left');
  });

  it('a deleted item stays deleted after reload', () => {
    add('Keep me', 'Delete me');
    cy.get('.todo-list li').eq(1).find('.destroy').click({ force: true });
    cy.get('.todo-list li').should('have.length', 1);
    cy.reload();
    titles(['Keep me']);
  });

  it('mark-all completes and restores every item', () => {
    add('Plan meals', 'Buy groceries', 'Cook dinner');
    cy.get('.toggle-all').check({ force: true });
    cy.get('.todo-list li .toggle').each($box => expect($box).to.be.checked);
    cy.get('.todo-count').should('contain.text', '0 items left');
    cy.get('.clear-completed').should('be.visible');
    cy.get('.toggle-all').uncheck({ force: true });
    cy.get('.todo-list li .toggle').each($box => expect($box).not.to.be.checked);
    cy.get('.todo-count').should('contain.text', '3 items left');
  });
});
