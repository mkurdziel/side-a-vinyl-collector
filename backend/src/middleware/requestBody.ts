import express from 'express';

// A 10 MiB image becomes 13.34 MiB when encoded as base64 in JSON.
export const jsonBodyParser = express.json({ limit: '14mb' });
