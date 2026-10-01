import { describe, expect, it } from 'vitest';
import { AgentError } from '../agent/client';
import {
  AGENT_DOCS_URL,
  AGENT_INSTALL_COMMAND,
  DEFAULT_AGENT_ALLOWED_ORIGINS,
  agentHostLabel,
  buildAgentStartCommand,
  computeConnectSteps,
  describeAgentError,
} from '../agent/connectGuide';

const DEV = 'http://localhost:5173';
const BASE = 'http://127.0.0.1:8521';

describe('constants', () => {
  it('exposes the default origins, install command and docs link', () => {
    expect(DEFAULT_AGENT_ALLOWED_ORIGINS).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173']);
    expect(AGENT_INSTALL_COMMAND).toContain('pipx install git+https://github.com/davidbudac/oraplanviz-db-connector');
    expect(AGENT_DOCS_URL).toMatch(/^https:\/\/github\.com\/davidbudac\/oraplanviz-db-connector/);
  });
});

describe('buildAgentStartCommand', () => {
  it('is bare for the default dev origin and port', () => {
    expect(buildAgentStartCommand(DEV, BASE)).toBe('oraplanviz-agent');
    expect(buildAgentStartCommand('http://127.0.0.1:5173', BASE)).toBe('oraplanviz-agent');
  });

  it('adds --port for a non-default port', () => {
    expect(buildAgentStartCommand(DEV, 'http://127.0.0.1:9000/')).toBe('oraplanviz-agent --port 9000');
  });

  it('adds --allow-origin for a non-default origin', () => {
    expect(buildAgentStartCommand('https://davidbudac.github.io', BASE)).toBe(
      'oraplanviz-agent --allow-origin https://davidbudac.github.io',
    );
  });

  it('combines both flags', () => {
    expect(buildAgentStartCommand('http://localhost:4173', 'http://localhost:9000')).toBe(
      'oraplanviz-agent --port 9000 --allow-origin http://localhost:4173',
    );
  });

  it('skips empty / null origins and survives bad URLs', () => {
    expect(buildAgentStartCommand('', BASE)).toBe('oraplanviz-agent');
    expect(buildAgentStartCommand('null', BASE)).toBe('oraplanviz-agent');
    expect(buildAgentStartCommand(DEV, 'not a url')).toBe('oraplanviz-agent');
    expect(buildAgentStartCommand(DEV, '')).toBe('oraplanviz-agent');
  });
});

describe('agentHostLabel', () => {
  it('shows host:port', () => {
    expect(agentHostLabel(BASE)).toBe('127.0.0.1:8521');
    expect(agentHostLabel('garbage')).toBe('garbage');
  });
});

describe('computeConnectSteps', () => {
  const base = { agentReachable: true, agentOutdated: false, tokenStatus: 'unknown', dbConnected: false } as const;

  it('is on step 1 while probing, with the rest locked', () => {
    expect(computeConnectSteps({ ...base, agentReachable: null })).toEqual({
      agent: 'current', token: 'locked', database: 'locked', plan: 'locked',
    });
  });

  it('keeps step 1 as the current (waiting) step when the agent is unreachable — not an error', () => {
    expect(computeConnectSteps({ ...base, agentReachable: false })).toEqual({
      agent: 'current', token: 'locked', database: 'locked', plan: 'locked',
    });
  });

  it('moves to the token step once the agent is found', () => {
    expect(computeConnectSteps(base)).toEqual({ agent: 'done', token: 'current', database: 'locked', plan: 'locked' });
    expect(computeConnectSteps({ ...base, tokenStatus: 'checking' }).token).toBe('current');
  });

  it('marks a rejected token as an error and keeps later steps locked', () => {
    expect(computeConnectSteps({ ...base, tokenStatus: 'invalid' })).toEqual({
      agent: 'done', token: 'error', database: 'locked', plan: 'locked',
    });
  });

  it('opens the database step once the token is valid', () => {
    expect(computeConnectSteps({ ...base, tokenStatus: 'valid' })).toEqual({
      agent: 'done', token: 'done', database: 'current', plan: 'locked',
    });
  });

  it('opens the plan step once the database is connected', () => {
    expect(computeConnectSteps({ ...base, tokenStatus: 'valid', dbConnected: true })).toEqual({
      agent: 'done', token: 'done', database: 'done', plan: 'current',
    });
  });

  it('never unlocks later steps past an unfinished one, even if dbConnected is set', () => {
    expect(computeConnectSteps({ ...base, tokenStatus: 'invalid', dbConnected: true }).plan).toBe('locked');
    expect(computeConnectSteps({ ...base, agentReachable: false, dbConnected: true }).database).toBe('locked');
  });

  it('treats an outdated agent as reachable', () => {
    expect(computeConnectSteps({ ...base, agentOutdated: true }).agent).toBe('done');
  });
});

describe('describeAgentError', () => {
  const ctx = { baseUrl: BASE, origin: 'https://example.com' };

  it('explains an unreachable connector and the origin fix', () => {
    const text = describeAgentError(new AgentError('Agent not reachable at x. Is it running?'), ctx);
    expect(text).toContain("Can't reach the connector at http://127.0.0.1:8521");
    expect(text).toContain('--allow-origin https://example.com');
    expect(describeAgentError(new TypeError('Failed to fetch'), ctx)).toContain("Can't reach the connector");
  });

  it('explains a rejected token', () => {
    const text = describeAgentError(new AgentError('Missing or invalid bearer token', 401), ctx);
    expect(text).toContain('rejected the token');
    expect(text).toContain('--token');
  });

  it('hints at bad credentials for ORA-01017', () => {
    expect(describeAgentError(new AgentError('ORA-01017: invalid username/password', 400), ctx)).toMatch(/username or password/);
  });

  it('hints at the DSN for listener / network errors', () => {
    for (const msg of ['ORA-12514: listener does not know of service', 'ORA-12541: no listener', 'DPY-6005: cannot connect to database']) {
      expect(describeAgentError(new AgentError(msg, 400), ctx)).toMatch(/host, port and service name/);
    }
  });

  it('passes other messages through', () => {
    expect(describeAgentError(new AgentError('No plan found for the given sql_id', 404), ctx)).toBe(
      'No plan found for the given sql_id',
    );
    expect(describeAgentError(new Error('boom'), ctx)).toBe('boom');
  });
});
