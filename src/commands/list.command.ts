import type { Command } from 'commander';

import { describeAvailability } from '../registry/capability-index.js';
import { describeSource, type GeneratorRegistry } from '../registry/generator-registry.js';
import { describeCount } from '../utils/text.js';

import type { CommandContext } from './register-commands.js';

export function registerListCommand(
  program: Command,
  context: CommandContext,
  registry: GeneratorRegistry,
): void {
  program
    .command('list')
    .alias('ls')
    .description('List the generators available in this project.')
    .action(async () => {
      await runList(context, registry);
    });
}

async function runList(context: CommandContext, registry: GeneratorRegistry): Promise<void> {
  const { reporter } = context;
  const { cwd } = context.globals();

  // The registry is discovered once per invocation and shared, because the command tree is
  // built from it — rediscovering here would import every plugin a second time.
  const project = await context.scanner.scan(cwd);

  if (registry.size === 0) {
    reporter.info('No generators are registered yet.');
    reporter.detail('Built-in generators arrive in Phase 3; see docs/project-plan.md.');
    reporter.detail('Third-party generators are picked up from any atlas-plugin-* dependency.');
    return;
  }

  const availability = describeAvailability(registry, project);
  const nameWidth = Math.max(...availability.map((item) => item.entry.generator.meta.name.length));

  reporter.heading('Generators');

  for (const item of availability) {
    const { meta } = item.entry.generator;
    const line = `${meta.name.padEnd(nameWidth)}  ${meta.summary}`;

    // Applicability is advisory here — the generator's own detect() is authoritative — so an
    // inapplicable generator is dimmed rather than hidden. Hiding it just prompts the
    // question "why isn't auth listed?" with no way to answer it.
    if (item.applicable) {
      reporter.success(line);
    } else {
      reporter.warn(`${line}  (${item.reason ?? 'not applicable here'})`);
    }

    if (meta.aliases.length > 0) {
      reporter.detail(`aliases: ${meta.aliases.join(', ')}`);
    }

    if (item.entry.source.kind !== 'builtin') {
      reporter.detail(`from ${describeSource(item.entry.source)}`);
    }
  }

  reporter.blank();
  reporter.plain(`  ${describeCount(registry.size, 'generator')} registered.`);
}
