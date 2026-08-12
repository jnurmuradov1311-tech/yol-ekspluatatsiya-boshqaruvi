create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

comment on schema extensions is
  'Extension objects for the local RoadOps PostgreSQL/PostGIS development stack.';
