import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {refreshAllProjects} from '../../src/configuration/refreshProjectConfiguration';

// Business rules:
// - One refresh attempt per pom path, in the given order.
// - Failures are isolated: a rejection on pom A does not stop pom B from
//   being attempted. The Red Hat Java extension may not be installed,
//   which would cause every call to reject — Jaenvtix must keep working.

describe('refreshAllProjects', () => {
    it('invokes the refresher exactly once per pom path, in order', async () => {
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
});
