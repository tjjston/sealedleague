import {
  Button,
  Center,
  Checkbox,
  Divider,
  Grid,
  Group,
  Modal,
  NumberInput,
  Select,
  Text,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { showNotification } from '@mantine/notifications';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SWRResponse } from 'swr';

import DeleteButton from '@components/buttons/delete';
import { formatMatchInput1, formatMatchInput2 } from '@components/utils/match';
import { TournamentMinimal } from '@components/utils/tournament';
import { MatchWithDetails, RoundWithMatches, StagesWithStageItemsResponse } from '@openapi';
import { getLeagueDecks } from '@services/adapter';
import { getMatchLookup, getStageItemLookup } from '@services/lookups';
import {
  deleteMatch,
  updateKarabastGameName,
  updateMatch,
  updateMatchDecks,
} from '@services/match';

function normalizePersonName(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase();
}

function getStageInputParticipantNames(stageInput: any): Set<string> {
  const names = new Set<string>();
  const teamName = normalizePersonName(stageInput?.team?.name);
  if (teamName !== '') names.add(teamName);
  const players = Array.isArray(stageInput?.team?.players) ? stageInput.team.players : [];
  players.forEach((player: any) => {
    const playerName = normalizePersonName(player?.name);
    if (playerName !== '') names.add(playerName);
  });
  return names;
}

function MatchDeleteButton({
  tournamentData,
  match,
  swrStagesResponse,
  swrUpcomingMatchesResponse,
}: {
  tournamentData: TournamentMinimal;
  match: MatchWithDetails;
  swrStagesResponse: SWRResponse<StagesWithStageItemsResponse>;
  swrUpcomingMatchesResponse: SWRResponse | null;
}) {
  const { t } = useTranslation();
  return (
    <DeleteButton
      fullWidth
      onClick={async () => {
        await deleteMatch(tournamentData.id, match.id);
        await swrStagesResponse.mutate();
        if (swrUpcomingMatchesResponse != null) await swrUpcomingMatchesResponse.mutate();
      }}
      style={{ marginTop: '1rem' }}
      size="sm"
      title={t('remove_match_button')}
    />
  );
}

function MatchModalForm({
  tournamentData,
  match,
  swrStagesResponse,
  swrUpcomingMatchesResponse,
  setOpened,
  round,
  allowAdvancedSettings,
  allowDelete,
  karabastEnabled,
}: {
  tournamentData: TournamentMinimal;
  match: MatchWithDetails | null;
  swrStagesResponse: SWRResponse<StagesWithStageItemsResponse>;
  swrUpcomingMatchesResponse: SWRResponse | null;
  setOpened: any;
  round: RoundWithMatches | null;
  allowAdvancedSettings: boolean;
  allowDelete: boolean;
  karabastEnabled: boolean;
}) {
  if (match == null) {
    return null;
  }

  const { t } = useTranslation();
  const form = useForm({
    initialValues: {
      stage_item_input1_score: match.stage_item_input1_score,
      stage_item_input2_score: match.stage_item_input2_score,
      custom_duration_minutes: match.custom_duration_minutes,
      custom_margin_minutes: match.custom_margin_minutes,
    },

    validate: {
      stage_item_input1_score: (value) => (value >= 0 ? null : t('negative_score_validation')),
      stage_item_input2_score: (value) => (value >= 0 ? null : t('negative_score_validation')),
      custom_duration_minutes: (value) =>
        value == null || value >= 0 ? null : t('negative_match_duration_validation'),
      custom_margin_minutes: (value) =>
        value == null || value >= 0 ? null : t('negative_match_margin_validation'),
    },
  });

  const [customDurationEnabled, setCustomDurationEnabled] = useState(
    match.custom_duration_minutes != null
  );
  const [customMarginEnabled, setCustomMarginEnabled] = useState(
    match.custom_margin_minutes != null
  );
  const [karabastLobbyUrlInput, setKarabastLobbyUrlInput] = useState(
    String((match as any)?.karabast_game_name ?? '')
  );
  const [selectedDeck1Id, setSelectedDeck1Id] = useState<number | null>(
    (match as any)?.stage_item_input1_deck?.id != null
      ? Number((match as any).stage_item_input1_deck.id)
      : null
  );
  const [selectedDeck2Id, setSelectedDeck2Id] = useState<number | null>(
    (match as any)?.stage_item_input2_deck?.id != null
      ? Number((match as any).stage_item_input2_deck.id)
      : null
  );
  const swrLeagueDecksResponse = getLeagueDecks(tournamentData.id);
  const allDecks = swrLeagueDecksResponse.data?.data ?? [];

  useEffect(() => {
    setSelectedDeck1Id(
      (match as any)?.stage_item_input1_deck?.id != null
        ? Number((match as any).stage_item_input1_deck.id)
        : null
    );
    setSelectedDeck2Id(
      (match as any)?.stage_item_input2_deck?.id != null
        ? Number((match as any).stage_item_input2_deck.id)
        : null
    );
  }, [match?.id]);

  const player1Names = useMemo(
    () => getStageInputParticipantNames((match as any)?.stage_item_input1),
    [match]
  );
  const player2Names = useMemo(
    () => getStageInputParticipantNames((match as any)?.stage_item_input2),
    [match]
  );
  const buildDeckOptions = (participantNames: Set<string>, selectedDeck: any | null) => {
    const options = (allDecks as any[])
      .filter((deck: any) => participantNames.has(normalizePersonName(deck?.user_name)))
      .map((deck: any) => {
        const deckId = Number(deck?.id ?? 0);
        return {
          value: String(deckId),
          label: `${String(deck?.name ?? `Deck ${deckId}`)} (${String(deck?.user_name ?? 'Unknown')})`,
        };
      });

    const selectedDeckId = Number(selectedDeck?.id ?? 0);
    if (
      Number.isInteger(selectedDeckId) &&
      selectedDeckId > 0 &&
      !options.some((option) => Number(option.value) === selectedDeckId)
    ) {
      options.unshift({
        value: String(selectedDeckId),
        label: `${String(selectedDeck?.name ?? `Deck ${selectedDeckId}`)} (Current)`,
      });
    }
    return options;
  };
  const side1DeckOptions = useMemo(
    () => buildDeckOptions(player1Names, (match as any)?.stage_item_input1_deck ?? null),
    [allDecks, match, player1Names]
  );
  const side2DeckOptions = useMemo(
    () => buildDeckOptions(player2Names, (match as any)?.stage_item_input2_deck ?? null),
    [allDecks, match, player2Names]
  );
  const normalizeKarabastLobbyUrl = (rawValue: string | null | undefined) => {
    const normalized = String(rawValue ?? '').trim();
    if (normalized === '') return null;
    try {
      const parsed = new URL(normalized);
      if (!['http:', 'https:'].includes(parsed.protocol)) return null;
      const hostname = parsed.hostname.toLowerCase();
      if (hostname !== 'karabast.net' && hostname !== 'www.karabast.net') return null;
      return parsed.toString();
    } catch (_error) {
      return null;
    }
  };
  const normalizedKarabastLobbyUrl = normalizeKarabastLobbyUrl(karabastLobbyUrlInput);

  const stageItemsLookup = getStageItemLookup(swrStagesResponse);
  const matchesLookup = getMatchLookup(swrStagesResponse);

  const team1Name = formatMatchInput1(t, stageItemsLookup, matchesLookup, match);
  const team2Name = formatMatchInput2(t, stageItemsLookup, matchesLookup, match);

  return (
    <>
      <form
        onSubmit={form.onSubmit(async (values) => {
          const updatedMatch = {
            id: match.id,
            round_id: match.round_id,
            stage_item_input1_score: values.stage_item_input1_score,
            stage_item_input2_score: values.stage_item_input2_score,
            court_id: match.court_id || null,
            custom_duration_minutes: customDurationEnabled ? values.custom_duration_minutes : null,
            custom_margin_minutes: customMarginEnabled ? values.custom_margin_minutes : null,
          };
          await updateMatch(tournamentData.id, match.id, updatedMatch);
          await swrStagesResponse.mutate();
          if (swrUpcomingMatchesResponse != null) await swrUpcomingMatchesResponse.mutate();
          setOpened(false);
        })}
      >
        <NumberInput
          withAsterisk
          label={`${t('score_of_label')} ${team1Name}`}
          placeholder={`${t('score_of_label')} ${team1Name}`}
          {...form.getInputProps('stage_item_input1_score')}
        />
        <NumberInput
          withAsterisk
          mt="lg"
          label={`${t('score_of_label')} ${team2Name}`}
          placeholder={`${t('score_of_label')} ${team2Name}`}
          {...form.getInputProps('stage_item_input2_score')}
        />
        <Divider mt="lg" />
        <Text size="sm" mt="lg">
          Match Deck Selection
        </Text>
        <Text size="xs" c="dimmed" mb="xs">
          Pick the deck used by each player in this game.
        </Text>
        <Select
          label={`${team1Name} deck`}
          searchable
          clearable
          value={selectedDeck1Id != null ? String(selectedDeck1Id) : null}
          data={side1DeckOptions}
          onChange={(value) => {
            const parsed = Number(value ?? 0);
            setSelectedDeck1Id(Number.isInteger(parsed) && parsed > 0 ? parsed : null);
          }}
        />
        <Select
          mt="sm"
          label={`${team2Name} deck`}
          searchable
          clearable
          value={selectedDeck2Id != null ? String(selectedDeck2Id) : null}
          data={side2DeckOptions}
          onChange={(value) => {
            const parsed = Number(value ?? 0);
            setSelectedDeck2Id(Number.isInteger(parsed) && parsed > 0 ? parsed : null);
          }}
        />
        <Button
          mt="sm"
          type="button"
          variant="light"
          onClick={async () => {
            const response = await updateMatchDecks(
              tournamentData.id,
              match.id,
              selectedDeck1Id,
              selectedDeck2Id
            );
            if (response == null || Number((response as any)?.status ?? 500) >= 400) return;
            await swrStagesResponse.mutate();
            if (swrUpcomingMatchesResponse != null) await swrUpcomingMatchesResponse.mutate();
            showNotification({
              color: 'green',
              title: 'Match deck selections updated',
              message: '',
            });
          }}
        >
          Save Deck Selections
        </Button>
        {karabastEnabled ? (
          <>
            <Divider mt="lg" />
            <Text size="sm" mt="lg">
              Karabast Lobby Invite URL
            </Text>
            <Text size="xs" c="dimmed" mb="xs">
              Paste a full URL like https://karabast.net/lobby?lobbyId=...
            </Text>
            <Group grow align="end">
              <TextInput
                value={karabastLobbyUrlInput}
                onChange={(event) => setKarabastLobbyUrlInput(event.currentTarget.value)}
                placeholder="https://karabast.net/lobby?lobbyId=..."
              />
              <Button
                type="button"
                variant="light"
                onClick={async () => {
                  if (karabastLobbyUrlInput.trim() !== '' && normalizedKarabastLobbyUrl == null) {
                    showNotification({
                      color: 'red',
                      title: 'Invalid Karabast link',
                      message: 'Use a full https://karabast.net/... invite URL.',
                    });
                    return;
                  }
                  await updateKarabastGameName(
                    tournamentData.id,
                    match.id,
                    normalizedKarabastLobbyUrl
                  );
                  setKarabastLobbyUrlInput(normalizedKarabastLobbyUrl ?? '');
                  await swrStagesResponse.mutate();
                  if (swrUpcomingMatchesResponse != null) await swrUpcomingMatchesResponse.mutate();
                }}
              >
                Save Lobby Link
              </Button>
              <Button
                type="button"
                variant="outline"
                component="a"
                href={normalizedKarabastLobbyUrl ?? 'https://karabast.net/'}
                target="_blank"
                rel="noreferrer"
              >
                Open Lobby
              </Button>
            </Group>
          </>
        ) : null}
        {allowAdvancedSettings ? (
          <>
            <Divider mt="lg" />

            <Text size="sm" mt="lg">
              {t('custom_match_duration_label')}
            </Text>
            <Grid align="center">
              <Grid.Col span={{ sm: 8 }}>
                <NumberInput
                  disabled={!customDurationEnabled}
                  rightSection={<Text>{t('minutes')}</Text>}
                  placeholder={`${match.duration_minutes}`}
                  rightSectionWidth={92}
                  {...form.getInputProps('custom_duration_minutes')}
                />
              </Grid.Col>
              <Grid.Col span={{ sm: 4 }}>
                <Center>
                  <Checkbox
                    checked={customDurationEnabled}
                    label={t('customize_checkbox_label')}
                    onChange={(event) => {
                      setCustomDurationEnabled(event.currentTarget.checked);
                    }}
                  />
                </Center>
              </Grid.Col>
            </Grid>

            <Text size="sm" mt="lg">
              {t('custom_match_margin_label')}
            </Text>
            <Grid align="center">
              <Grid.Col span={{ sm: 8 }}>
                <NumberInput
                  disabled={!customMarginEnabled}
                  placeholder={`${match.margin_minutes}`}
                  rightSection={<Text>{t('minutes')}</Text>}
                  rightSectionWidth={92}
                  {...form.getInputProps('custom_margin_minutes')}
                />
              </Grid.Col>
              <Grid.Col span={{ sm: 4 }}>
                <Center>
                  <Checkbox
                    checked={customMarginEnabled}
                    label={t('customize_checkbox_label')}
                    onChange={(event) => {
                      setCustomMarginEnabled(event.currentTarget.checked);
                    }}
                  />
                </Center>
              </Grid.Col>
            </Grid>
          </>
        ) : null}

        <Button fullWidth style={{ marginTop: 20 }} color="green" type="submit">
          {t('save_button')}
        </Button>
      </form>
      {allowDelete && round && round.is_draft && (
        <MatchDeleteButton
          swrStagesResponse={swrStagesResponse}
          swrUpcomingMatchesResponse={swrUpcomingMatchesResponse}
          tournamentData={tournamentData}
          match={match}
        />
      )}
    </>
  );
}

export default function MatchModal({
  tournamentData,
  match,
  swrStagesResponse,
  swrUpcomingMatchesResponse,
  opened,
  setOpened,
  round,
  allowAdvancedSettings = true,
  allowDelete = true,
  karabastEnabled = true,
}: {
  tournamentData: TournamentMinimal;
  match: MatchWithDetails | null;
  swrStagesResponse: SWRResponse<StagesWithStageItemsResponse>;
  swrUpcomingMatchesResponse: SWRResponse | null;
  opened: boolean;
  setOpened: any;
  round: RoundWithMatches | null;
  allowAdvancedSettings?: boolean;
  allowDelete?: boolean;
  karabastEnabled?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <>
      <Modal opened={opened} onClose={() => setOpened(false)} title={t('edit_match_modal_title')}>
        <MatchModalForm
          swrStagesResponse={swrStagesResponse}
          swrUpcomingMatchesResponse={swrUpcomingMatchesResponse}
          tournamentData={tournamentData}
          match={match}
          setOpened={setOpened}
          round={round}
          allowAdvancedSettings={allowAdvancedSettings}
          allowDelete={allowDelete}
          karabastEnabled={karabastEnabled}
        />
      </Modal>
    </>
  );
}
