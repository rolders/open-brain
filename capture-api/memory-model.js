function normalizeEntityName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveEntity(client, {
  tenantId,
  workspaceId,
  entityType,
  name,
  confidence = null,
}) {
  const canonicalName = String(name || '').trim();
  if (!canonicalName) return null;

  const normalized = normalizeEntityName(canonicalName);
  if (!normalized) return null;

  const aliasResult = await client.query(
    `SELECT e.id, e.canonical_name
     FROM entity_aliases a
     JOIN entities e ON e.id = a.entity_id
     WHERE a.workspace_id = $1 AND a.normalized_alias = $2
     LIMIT 1`,
    [workspaceId, normalized],
  );

  let entityId;

  if (aliasResult.rows.length > 0) {
    entityId = aliasResult.rows[0].id;
  } else {
    const entityResult = await client.query(
      `INSERT INTO entities (tenant_id, workspace_id, entity_type, canonical_name, normalized_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, entity_type, normalized_name)
       DO UPDATE SET canonical_name = entities.canonical_name
       RETURNING id`,
      [tenantId, workspaceId, entityType, canonicalName, normalized],
    );

    entityId = entityResult.rows[0].id;
  }

  await client.query(
    `INSERT INTO entity_aliases (entity_id, workspace_id, alias_name, normalized_alias)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, normalized_alias)
     DO UPDATE SET entity_id = EXCLUDED.entity_id`,
    [entityId, workspaceId, canonicalName, normalized],
  );

  return { entityId, confidence };
}

async function persistNormalizedMemory(client, {
  thoughtId,
  tenantId,
  workspaceId,
  content,
  metadata,
}) {
  const memoryResult = await client.query(
    `INSERT INTO memory_items (thought_id, tenant_id, workspace_id, content, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (thought_id)
     DO UPDATE SET content = EXCLUDED.content, metadata = EXCLUDED.metadata
     RETURNING id`,
    [thoughtId, tenantId, workspaceId, content, JSON.stringify(metadata || {})],
  );

  const memoryItemId = memoryResult.rows[0].id;
  const extracted = metadata?.extracted || {};

  for (const person of extracted.people || []) {
    const resolved = await resolveEntity(client, {
      tenantId,
      workspaceId,
      entityType: 'person',
      name: person?.name,
      confidence: person?.confidence ?? null,
    });

    if (!resolved) continue;

    await client.query(
      `INSERT INTO memory_entity_links (memory_item_id, entity_id, relation_type, confidence)
       VALUES ($1, $2, 'mentioned', $3)
       ON CONFLICT (memory_item_id, entity_id, relation_type)
       DO UPDATE SET confidence = EXCLUDED.confidence`,
      [memoryItemId, resolved.entityId, resolved.confidence],
    );
  }

  for (const topic of extracted.topics || []) {
    const resolved = await resolveEntity(client, {
      tenantId,
      workspaceId,
      entityType: 'topic',
      name: topic?.name,
      confidence: topic?.confidence ?? null,
    });

    if (!resolved) continue;

    await client.query(
      `INSERT INTO memory_entity_links (memory_item_id, entity_id, relation_type, confidence)
       VALUES ($1, $2, 'topic', $3)
       ON CONFLICT (memory_item_id, entity_id, relation_type)
       DO UPDATE SET confidence = EXCLUDED.confidence`,
      [memoryItemId, resolved.entityId, resolved.confidence],
    );
  }

  for (const action of extracted.action_items || []) {
    let assigneeEntityId = null;
    if (action?.assignee) {
      const resolvedAssignee = await resolveEntity(client, {
        tenantId,
        workspaceId,
        entityType: 'person',
        name: action.assignee,
      });
      assigneeEntityId = resolvedAssignee?.entityId || null;
    }

    await client.query(
      `INSERT INTO action_items
         (memory_item_id, tenant_id, workspace_id, action_type, description, assignee_entity_id, deadline, status, confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (memory_item_id, action_type, description)
       DO UPDATE SET
         assignee_entity_id = EXCLUDED.assignee_entity_id,
         deadline = EXCLUDED.deadline,
         status = EXCLUDED.status,
         confidence = EXCLUDED.confidence`,
      [
        memoryItemId,
        tenantId,
        workspaceId,
        action?.type || 'task',
        action?.description || '',
        assigneeEntityId,
        action?.deadline || null,
        action?.status || null,
        action?.confidence ?? null,
      ],
    );
  }

  return { memoryItemId };
}

module.exports = {
  persistNormalizedMemory,
};
