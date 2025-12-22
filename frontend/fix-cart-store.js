const fs = require('fs');
const path = 'src/store/cartStore.ts';
let content = fs.readFileSync(path, 'utf8');

// Add currency to interface state (before // Actions)
if (!content.includes('currency: string | null;')) {
  content = content.replace(
    'tableId: string | null;\n\n  // Actions',
    'tableId: string | null;\n  currency: string | null;\n\n  // Actions'
  );
}

// Add currency to initial state (if not already there)
if (!content.includes('currency: null,')) {
  content = content.replace(
    'tableId: null,\n\n      initializeSession:',
    'tableId: null,\n      currency: null,\n\n      initializeSession:'
  );
}

// Add setCurrency action after setTableId (if not already there)
if (!content.includes('setCurrency:')) {
  content = content.replace(
    'setTableId: (tableId: string) => {\n        set({ tableId });\n      },\n\n      addItem:',
    'setTableId: (tableId: string) => {\n        set({ tableId });\n      },\n\n      setCurrency: (currency: string) => {\n        set({ currency });\n      },\n\n      addItem:'
  );
}

// Add currency to partialize (if not already there)
if (!content.includes('currency: state.currency,')) {
  content = content.replace(
    'tableId: state.tableId,\n      }),',
    'tableId: state.tableId,\n        currency: state.currency,\n      }),'
  );
}

// Update first initializeSession set call to include currency
content = content.replace(
  /set\(\{\n            sessionId: generateSessionId\(\),\n            tenantId,\n            tableId,\n            items: \[\],\n          \}\);/,
  `set({
            sessionId: generateSessionId(),
            tenantId,
            tableId,
            currency: currency || null,
            items: [],
          });`
);

// Update second initializeSession set call to include currency
content = content.replace(
  /} else if \(!currentSession\) \{\n          \/\/ First time initialization\n          set\(\{\n            sessionId: generateSessionId\(\),\n            tenantId,\n            tableId,\n          \}\);/,
  `} else if (!currentSession) {
          // First time initialization
          set({
            sessionId: generateSessionId(),
            tenantId,
            tableId,
            currency: currency || null,
          });`
);

fs.writeFileSync(path, content);
console.log('Cart store updated!');
