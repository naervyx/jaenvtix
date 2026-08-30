import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {refreshAllProjects} from '../../src/configuration/refreshProjectConfiguration';

// Business rules:
// - One refresh attempt per pom path; attempts START in input order.
// - Requests run through a bounded concurrency pool (JDT queues and
//   serializes the actual imports internally).
// - Failures are isolated: a rejection on pom A does not stop pom B from
//   being attempted. The Red Hat Java extension may not be installed,
//   which would cause every call to reject; Jaenvtix must keep working.

describe('refreshAllProjects', () => {
    it('invokes the refresher exactly once per pom path, starting in order', async () => {
        const calls: string[] = [];
        const refresher = async (pomPath: string) => {
            calls.push(pomPath);
        };

        const summary = await refreshAllProjects(
            ['/ws/a/pom.xml', '/ws/b/pom.xml', '/ws/c/pom.xml'],
            refresher,
        );

        assert.deepEqual(calls, ['/ws/a/pom.xml', '/ws/b/pom.xml', '/ws/c/pom.xml']);
        assert.equal(summary.succeeded, 3);
        assert.equal(summary.failed, 0);
    });

    it('continues attempting subsequent poms after one rejects', async () => {
        const calls: string[] = [];
        const refresher = async (pomPath: string) => {
            calls.push(pomPath);
            if (pomPath.includes('b')) {
                throw new Error('boom');
            }
        };

        const summary = await refreshAllProjects(
            ['/ws/a/pom.xml', '/ws/b/pom.xml', '/ws/c/pom.xml'],
            refresher,
        );

        // Crucially, c was reached even though b threw.
        assert.deepEqual(calls, ['/ws/a/pom.xml', '/ws/b/pom.xml', '/ws/c/pom.xml']);
        assert.equal(summary.succeeded, 2);
        assert.equal(summary.failed, 1);
    });

    it('reports zero successes and zero failures when given no poms', async () => {
        let invoked = false;
        const refresher = async () => {
            invoked = true;
        };

        const summary = await refreshAllProjects([], refresher);

        assert.equal(invoked, false);
        assert.equal(summary.succeeded, 0);
        assert.equal(summary.failed, 0);
    });

    it('reports all failures when every refresh rejects (e.g. Red Hat extension missing)', async () => {
        const refresher = async () => {
            throw new Error('command "java.projectConfiguration.update" not found');
        };

        const summary = await refreshAllProjects(['/ws/a/pom.xml', '/ws/b/pom.xml'], refresher);

        assert.equal(summary.succeeded, 0);
        assert.equal(summary.failed, 2);
    });

    it('keeps at most the pool limit in flight, but does overlap requests', async () => {
        let inFlight = 0;
        let peak = 0;
        const refresher = async () => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 5));
            inFlight--;
        };

        const poms = Array.from({length: 10}, (_, index) => `/ws/m${index}/pom.xml`);
        const summary = await refreshAllProjects(poms, refresher, 4);

        assert.equal(summary.succeeded, 10);
        assert.ok(peak <= 4, `expected at most 4 in flight, saw ${peak}`);
        assert.ok(peak > 1, 'expected refreshes to overlap instead of running one-by-one');
    });
});
