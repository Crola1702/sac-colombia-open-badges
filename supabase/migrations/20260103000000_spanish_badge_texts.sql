-- Spanish texts for the seeded badge types. Slugs and the issuer name stay unchanged.
update public.achievements set
  name = 'Participante de pruebas',
  description = 'Se otorga por participar en una prueba del sistema de insignias del SAC Team IEEE Colombia.',
  criteria = 'Participó en una prueba del proceso de emisión de insignias.'
where slug = 'test-participant';

update public.achievements set
  name = 'Completó la wiki',
  description = 'Se otorga por completar la wiki del SAC Team IEEE Colombia.',
  criteria = 'Leyó y completó todas las secciones de la wiki del SAC Team IEEE Colombia.'
where slug = 'completed-the-wiki';

update public.achievements set
  name = 'Voluntario destacado',
  description = 'Se otorga por una labor voluntaria destacada en IEEE Colombia.',
  criteria = 'Fue reconocido por el SAC Team por sus contribuciones excepcionales como voluntario.'
where slug = 'outstanding-volunteer';

update public.achievements set
  name = 'Asistente a evento',
  description = 'Se otorga por asistir a un evento de IEEE Colombia.',
  criteria = 'Asistió a un evento organizado por IEEE Colombia.'
where slug = 'event-attendee';
