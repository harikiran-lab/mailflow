import routes from './routes.js';
export const notetracePlugin = { id: 'notetrace', name: 'NoteTrace', version: '1.0.0', tier: 1, router: { base: '/api/notetrace', handler: routes } };
