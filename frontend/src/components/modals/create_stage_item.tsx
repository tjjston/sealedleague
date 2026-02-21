import {
  Button,
  Card,
  Divider,
  Grid,
  Image,
  Modal,
  NumberInput,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { UseFormReturnType, useForm } from '@mantine/form';
import { GoPlus } from '@react-icons/all-files/go/GoPlus';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SWRResponse } from 'swr';

import { Translator } from '@components/utils/types';
import {
  StageItemInputOptionsResponse,
  StageWithStageItems,
  StagesWithStageItemsResponse,
  Tournament,
} from '@openapi';
import { getStageItemLookup, getTeamsLookup } from '@services/lookups';
import { createStageItem } from '@services/stage_item';
import classes from './create_stage_item.module.css';

function StageSelectCard({
  title,
  description,
  image,
  selected,
  onClick,
}: {
  title: string;
  description: string;
  image: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <UnstyledButton onClick={onClick} w="100%">
      <Card
        shadow="sm"
        padding="lg"
        radius="lg"
        h="23rem"
        withBorder
        className={classes.socialLink}
        style={{ border: selected ? '3px solid var(--mantine-color-green-7)' : '' }}
      >
        <Card.Section style={{ backgroundColor: '#dde' }}>
          <Image src={image} h={212} style={{ padding: '1.5rem' }} fit="fill"></Image>
        </Card.Section>

        <Text fw={800} size="xl" mt="md" lineClamp={1}>
          {title}
        </Text>

        <Text mt="xs" c="dimmed" size="md" lineClamp={3}>
          {description}
        </Text>
      </Card>
    </UnstyledButton>
  );
}

export function CreateStagesFromTemplateButtons({
  selectedType,
  setSelectedType,
  t,
}: {
  selectedType:
    | 'ROUND_ROBIN'
    | 'REGULAR_SEASON_MATCHUP'
    | 'SWISS'
    | 'SINGLE_ELIMINATION'
    | 'DOUBLE_ELIMINATION';
  setSelectedType: (
    type:
      | 'ROUND_ROBIN'
      | 'REGULAR_SEASON_MATCHUP'
      | 'SWISS'
      | 'SINGLE_ELIMINATION'
      | 'DOUBLE_ELIMINATION'
  ) => void;
  t: Translator;
}) {
  return (
    <Grid grow>
      <Grid.Col span={{ base: 12, sm: 4 }}>
        <StageSelectCard
          title={t('round_robin_label')}
          description={t('round_robin_description')}
          image="/icons/group-stage-item.svg"
          selected={selectedType === 'ROUND_ROBIN'}
          onClick={() => {
            setSelectedType('ROUND_ROBIN');
          }}
        />
      </Grid.Col>
      <Grid.Col span={{ base: 12, sm: 4 }}>
        <StageSelectCard
          title="Regular Season Matchup"
          description="Weekly 1v1 matchups where everyone rotates through the season."
          image="/icons/group-stage-item.svg"
          selected={selectedType === 'REGULAR_SEASON_MATCHUP'}
          onClick={() => {
            setSelectedType('REGULAR_SEASON_MATCHUP');
          }}
        />
      </Grid.Col>
      <Grid.Col span={{ base: 12, sm: 4 }}>
        <StageSelectCard
          title={t('single_elimination_label')}
          description={t('single_elimination_description')}
          image="/icons/single-elimination-stage-item.svg"
          selected={selectedType === 'SINGLE_ELIMINATION'}
          onClick={() => {
            setSelectedType('SINGLE_ELIMINATION');
          }}
        />
      </Grid.Col>
      <Grid.Col span={{ base: 12, sm: 4 }}>
        <StageSelectCard
          title="Double Elimination"
          description="Lose twice to be eliminated with winners and losers brackets."
          image="/icons/single-elimination-stage-item.svg"
          selected={selectedType === 'DOUBLE_ELIMINATION'}
          onClick={() => {
            setSelectedType('DOUBLE_ELIMINATION');
          }}
        />
      </Grid.Col>
      <Grid.Col span={{ base: 12, sm: 4 }}>
        <StageSelectCard
          title={t('swiss_label')}
          description={t('swiss_description')}
          image="/icons/swiss-stage-item.svg"
          selected={selectedType === 'SWISS'}
          onClick={() => {
            setSelectedType('SWISS');
          }}
        />
      </Grid.Col>
    </Grid>
  );
}

function TeamCountInputElimination({ form }: { form: UseFormReturnType<any> }) {
  const { t } = useTranslation();
  const isDoubleElimination = form.values.type === 'DOUBLE_ELIMINATION';
  const minimum = isDoubleElimination ? 3 : 2;
  return (
    <NumberInput
      withAsterisk
      label={t('team_count_select_elimination_label')}
      min={minimum}
      max={64}
      mt="1rem"
      maw="50%"
      {...form.getInputProps('team_count_elimination')}
    />
  );
}

function TeamCountInputRoundRobin({ form }: { form: UseFormReturnType<any> }) {
  const { t } = useTranslation();
  return (
    <NumberInput
      withAsterisk
      label={t('team_count_input_round_robin_label')}
      placeholder=""
      mt="1rem"
      maw="50%"
      {...form.getInputProps('team_count_round_robin')}
    />
  );
}

function TeamCountInput({ form }: { form: UseFormReturnType<any> }) {
  if (form.values.type === 'SINGLE_ELIMINATION' || form.values.type === 'DOUBLE_ELIMINATION') {
    return <TeamCountInputElimination form={form} />;
  }

  return <TeamCountInputRoundRobin form={form} />;
}

function getTeamCount(values: any) {
  return Number(
    values.type === 'SINGLE_ELIMINATION' || values.type === 'DOUBLE_ELIMINATION'
      ? values.team_count_elimination
      : values.team_count_round_robin
  );
}

interface FormValues {
  type:
    | 'ROUND_ROBIN'
    | 'REGULAR_SEASON_MATCHUP'
    | 'SWISS'
    | 'SINGLE_ELIMINATION'
    | 'DOUBLE_ELIMINATION';
  team_count_round_robin: number;
  team_count_elimination: number;
}
export function CreateStageItemModal({
  tournament,
  stage,
  swrStagesResponse,
  swrAvailableInputsResponse,
}: {
  tournament: Tournament;
  stage: StageWithStageItems;
  swrStagesResponse: SWRResponse<StagesWithStageItemsResponse>;
  swrAvailableInputsResponse: SWRResponse<StageItemInputOptionsResponse>;
}) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);

  const form = useForm<FormValues>({
    initialValues: { type: 'ROUND_ROBIN', team_count_round_robin: 4, team_count_elimination: 4 },
    validate: {
      team_count_round_robin: (value) => (value >= 2 ? null : t('at_least_two_team_validation')),
      team_count_elimination: (value, values) => {
        const minimum = values.type === 'DOUBLE_ELIMINATION' ? 3 : 2;
        if (value < minimum) return `Team count must be at least ${minimum}`;
        if (value > 64) return 'Team count cannot exceed 64';
        return null;
      },
    },
  });

  // TODO: Refactor lookups into one request.
  const teamsMap = getTeamsLookup(tournament != null ? tournament.id : -1);
  const stageItemMap = getStageItemLookup(swrStagesResponse);

  if (teamsMap == null || stageItemMap == null) {
    return null;
  }

  return (
    <>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={t('add_stage_item_modal_title')}
        size="60rem"
      >
        <form
          onSubmit={form.onSubmit(async (values) => {
            await createStageItem(tournament.id, stage.id, values.type, getTeamCount(values));
            await swrStagesResponse.mutate();
            await swrAvailableInputsResponse.mutate();
            setOpened(false);
          })}
        >
          <CreateStagesFromTemplateButtons
            t={t}
            selectedType={form.values.type}
            setSelectedType={(_type) => {
              form.setFieldValue('type', _type);
              if (_type === 'DOUBLE_ELIMINATION' && form.values.team_count_elimination < 3) {
                form.setFieldValue('team_count_elimination', 3);
              }
              if (_type === 'SINGLE_ELIMINATION' && form.values.team_count_elimination < 2) {
                form.setFieldValue('team_count_elimination', 2);
              }
            }}
          />
          <Divider mt="1rem" />
          <TeamCountInput form={form} />

          <Button fullWidth mt="1.5rem" color="green" type="submit">
            {t('create_stage_item_button')}
          </Button>
        </form>
      </Modal>

      <Button
        variant="outline"
        color="green"
        size="xs"
        onClick={() => setOpened(true)}
        leftSection={<GoPlus size={24} />}
      >
        {t('add_stage_item_modal_title')}
      </Button>
    </>
  );
}
